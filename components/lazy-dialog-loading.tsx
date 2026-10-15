import { Loader2 } from "lucide-react";

export function LazyDialogLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-medium text-neutral-700 shadow-xl dark:bg-neutral-900 dark:text-neutral-200">
        <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
        Abrindo
      </div>
    </div>
  );
}
