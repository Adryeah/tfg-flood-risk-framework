const subscribers = new Set();

const _state = {
  currentZone: 'valencia',
  currentPortfolio: null,
  isLoading: false,
  metrics: {
    valencia: null,
    algemesi: null,
  },
};

export const state = new Proxy(_state, {
  set(target, key, value) {
    target[key] = value;
    subscribers.forEach((fn) => fn(key, value));
    return true;
  },
});

export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
