let nextId = 1;

export function newId(): string {
  return `e${nextId++}`;
}
