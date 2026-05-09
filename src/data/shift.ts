// Sample shift events for Poste C (06h–14h) using the new type/category set.
import type { LogEvent } from '../types';

let nextId = 1;
const id = () => `e${nextId++}`;
