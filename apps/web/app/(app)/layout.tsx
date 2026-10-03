import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { PerfPanel } from "../../components/dev/PerfPanel";
import { MessageProvider } from "../../components/ui/message-handler";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MessageProvider>
      <div className="flex h-screen overflow-hidden bg-dim-100">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
        {process.env.NODE_ENV === "development" && <PerfPanel />}
      </div>
    </MessageProvider>
  );
}
