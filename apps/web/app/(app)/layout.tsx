import { AppShell } from "./app-shell";
import { MessageProvider } from "../../components/ui/message-handler";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MessageProvider>
      <AppShell>{children}</AppShell>
    </MessageProvider>
  );
}
