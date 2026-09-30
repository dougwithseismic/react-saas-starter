import type { Auth } from "../modules/auth/auth.js";
export type Session = Auth["$Infer"]["Session"];
export type AppEnv = { Variables: { requestId: string; session: Session } };
