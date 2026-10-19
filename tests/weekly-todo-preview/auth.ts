import { selectedProfile } from "./api";
export const useAuth = () => ({ profile: selectedProfile() });
