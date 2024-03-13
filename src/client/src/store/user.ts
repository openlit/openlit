import { User } from "@prisma/client";
import { create } from "zustand";

type UserStore = {
	user?: User;
  set: (u: User) => void;
  reset: () => void;
};

export const useCartStore = create<UserStore>((set) => ({
	user: undefined,
  set: (u) => set((state) => ({ user: u })),
  reset: () => set(() => ({ user: undefined })),
}));
