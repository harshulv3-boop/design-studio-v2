// Stub for the reference editor's prototype/connect store (pass b will implement).
import { create } from "zustand";
export const useFlowStore = create(() => ({
  pinMode: false,
  pinFromId: null,
  setPin: () => {},
  connections: [],
}));
