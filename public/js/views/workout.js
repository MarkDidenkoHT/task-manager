import { api, sp } from '../api.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { canWrite } from '../store.js';
import { haptic, notify, setMainButton } from '../tg.js';
import { fmt, html, load, openSheet, render, stepper, toast, toastError } from '../ui.js';
import { setsText } from './growth.js';

/** Экран тренировки: одно упражнение — одна карточка, подходы чипами. */
export async function session(root, { pid, dayId }) {
  let prog, day;
  const state = new Map(); // peId → { reps: number[], load }

  await load(root, () => api(sp(`/programs/${pid}`)), (p) => {
    prog = p;
    day = p.program_days.find((d) => d.id === dayId);
    if (!day) throw new Error('День программы не найден');
    for (const pe of day.program_exercises) {
      state.set(pe.id, { reps: Array.from({ length: pe.sets }, () => pe.target_reps), load: Number(pe.load_kg) });
    }
    draw();
    if (canWrite()) setMainButton('Готово', finish);
  }, { skeletonRows: 6 });

  function chipCls(pe, v) {
    return v >= pe.target_reps ? 'hit' : 'miss';
  }

  function draw() {
    render(
      root,
      html`<h1 class="screen-title" style="margin-bottom:4px">${day.label}</h1>
        <p class="screen-sub" style="margin-top:0">${prog.name}</p>
        <p class="caption" style="margin:0 0 12px">Нажмите на подход: +1 повтор (после потолка — сброс). Удерживайте, чтобы ввести число.</p>
        ${day.program_exercises.map((pe) => {
          const st = state.get(pe.id);
          const timed = pe.exercises?.kind === 'timed';
          const sug = pe.suggestion;
          return html`<div class="card" data-pe="${pe.id}">
            <div class="row between"><div class="card-title">${pe.exercises?.name}</div><span class="caption">${setsText(pe)}</span></div>
            ${sug && sug.action !== 'keep' ? html`<div class="suggest">${icon('flame')} ${sug.text.replace('В следующий раз', 'Сегодня')}</div>` : ''}
            ${pe.last ? html`<div class="caption">Прошлый раз: ${pe.last.sets.map((s) => s.reps).join(', ')}${pe.last.sets[0]?.load_kg > 0 ? ` × ${fmt(pe.last.sets[0].load_kg, 2)} кг` : ''}</div>` : ''}
            <div class="set-chips">${st.reps.map(
              (v, i) => html`<button class="set-chip ${chipCls(pe, v)}" data-set="${i}" aria-label="Подход ${i + 1}: ${v}">${v}${timed ? html`<small style="font-size:11px;font-weight:500">&nbsp;с</small>` : ''}</button>`
            )}</div>
            <div class="row between">
              ${Number(pe.load_kg) > 0 || Number(pe.load_step_kg) > 0
                ? html`<div class="row"><span class="muted small" style="white-space:nowrap">Вес, кг</span>${stepper('load_' + pe.id, st.load, { min: 0, max: 500, step: Number(pe.load_step_kg) || 0.5 })}</div>`
                : html`<span></span>`}
              <button class="btn small secondary" data-all="${pe.id}">${icon('check')} Все выполнены</button>
            </div>
          </div>`;
        })}`
    );
  }

  // Нажатие: +1; удержание — ввод числа.
  let pressTimer = null;
  let longPressed = false;
  root.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('[data-set]');
    if (!chip) return;
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      haptic('medium');
      const card = chip.closest('[data-pe]');
      const st = state.get(card.dataset.pe);
      const i = Number(chip.dataset.set);
      const val = window.prompt('Сколько выполнено?', String(st.reps[i]));
      const n = Number(val);
      if (val != null && Number.isFinite(n) && n >= 0) {
        st.reps[i] = Math.round(n);
        draw();
      }
    }, 550);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  root.addEventListener('pointerup', cancelPress);
  root.addEventListener('pointerleave', cancelPress);
  root.addEventListener('pointercancel', cancelPress);

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-set]');
    if (chip) {
      if (longPressed) return;
      const card = chip.closest('[data-pe]');
      const pe = day.program_exercises.find((x) => x.id === card.dataset.pe);
      const st = state.get(pe.id);
      const i = Number(chip.dataset.set);
      const step = pe.exercises?.kind === 'timed' ? 5 : 1;
      const top = Math.max(pe.rep_ceiling, pe.target_reps);
      st.reps[i] = st.reps[i] + step > top ? Math.max(0, pe.target_reps - 5 * step) : st.reps[i] + step;
      haptic('light');
      draw();
      return;
    }
    const all = e.target.closest('[data-all]');
    if (all) {
      const pe = day.program_exercises.find((x) => x.id === all.dataset.all);
      state.get(pe.id).reps = state.get(pe.id).reps.map((v) => Math.max(v, pe.target_reps));
      notify('success');
      draw();
    }
  });
  root.addEventListener('change', (e) => {
    const name = e.detail?.name || '';
    if (name.startsWith('load_')) state.get(name.slice(5)).load = Number(e.detail.value);
  });

  async function finish() {
    const results = [];
    try {
      for (const pe of day.program_exercises) {
        const st = state.get(pe.id);
        const r = await api(sp(`/program-exercises/${pe.id}/log`), {
          method: 'POST',
          body: { sets: st.reps.map((reps) => ({ reps, load_kg: st.load })) }
        });
        results.push({ pe, suggestion: r.suggestion });
      }
      // Отмечаем напоминание о тренировке по этой программе.
      try {
        const rems = await api(sp('/reminders?mine=1'));
        for (const r of rems.filter((x) => x.program_id === pid && x.today_status !== 'done')) {
          await api(sp(`/reminders/${r.id}/mark`), { method: 'POST', body: { status: 'done' } });
        }
      } catch {
        /* не критично */
      }
    } catch (e) {
      toastError(e);
      return;
    }
    notify('success');
    const ups = results.filter((r) => r.suggestion.action !== 'keep');
    const s = openSheet({
      title: 'Тренировка записана 💪',
      body: html`${ups.length
          ? html`<p class="muted small" style="margin-bottom:12px">Предложения на следующий раз — примите или оставьте как есть:</p>
            <div class="list plain" style="background:var(--fill)">${ups.map(
              (r) => html`<div class="list-row no-icon"><div class="body"><div class="title">${r.pe.exercises?.name}</div><div class="subtitle" style="color:var(--c-growth)">${r.suggestion.text}</div></div>
                <div class="trail"><button class="btn small" data-accept="${r.pe.id}">Принять</button></div></div>`
            )}</div>`
          : html`<p class="muted">Повторите те же цифры в следующий раз — прогресс придёт.</p>`}
        <div class="sheet-actions"><button class="btn block secondary" data-close>Готово</button></div>`,
      onClose: () => go(`/growth/program/${pid}`, { replace: true })
    });
    s.el.addEventListener('click', async (e) => {
      const acc = e.target.closest('[data-accept]');
      if (acc) {
        acc.disabled = true;
        try {
          await api(sp(`/program-exercises/${acc.dataset.accept}/accept`), { method: 'POST' });
          acc.textContent = '✓';
          haptic('light');
        } catch (err) {
          acc.disabled = false;
          toastError(err);
        }
      }
      if (e.target.closest('[data-close]')) s.close();
    });
    toast('Записано', 'success');
  }
}
