import { SettingsBackLink } from "./settings-back-link";

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SettingsBackLink />
      {children}
    </div>
  );
}
