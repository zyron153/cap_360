import Link from "next/link";
import { Stethoscope } from "lucide-react";

// fixed + inset-0 so it also covers the (app) sidebar/topbar when error.tsx re-uses it.
export default function NotFound() {
  return (
    <main className="fixed inset-0 z-50 bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700" />
        <div className="px-8 py-8 space-y-6 text-center">
          <div className="w-14 h-14 mx-auto bg-brand-600 rounded-2xl flex items-center justify-center shadow-sm">
            <Stethoscope className="w-7 h-7 text-white" />
          </div>
          <div>
            <p className="text-5xl font-bold text-brand-600">404</p>
            <h1 className="mt-2 text-lg font-bold text-slate-900">Página não encontrada</h1>
            <p className="mt-1 text-sm text-slate-500">
              A página não existe ou precisa de iniciar sessão para a ver.
            </p>
          </div>
          <Link
            href="/login"
            className="flex items-center justify-center w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-xl transition-all shadow-sm hover:shadow-md text-sm"
          >
            Ir para o login
          </Link>
        </div>
      </div>
    </main>
  );
}
