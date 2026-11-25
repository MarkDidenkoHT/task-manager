// Минимальное хранилище состояния: get / set / subscribe.
const state = {
  me: null,
  spaces: [],
  spaceId: null,
  space: null,
  role: 'viewer',
  currency: 'RUB'
};
const subs = new Set();

export const get = (key) => state[key];

export function set(patch) {
  Object.assign(state, patch);
  for (const fn of subs) fn(state);
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export const canWrite = () => state.role === 'owner' || state.role === 'editor';
export const isOwner = () => state.role === 'owner';
