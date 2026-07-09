"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";

export function ProfileAvatarForm({
  userId,
  name,
  email,
  photoUrl,
}: {
  userId: string;
  name: string;
  email: string;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`/api/org/members/${userId}/avatar`, { method: "POST", body: formData });
    setUploading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao enviar foto");
      return;
    }
    router.refresh();
  }

  async function handleRemove() {
    setUploading(true);
    setError(null);
    const res = await fetch(`/api/org/members/${userId}/avatar`, { method: "DELETE" });
    setUploading(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex items-center gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="relative shrink-0">
        <Avatar name={name} src={photoUrl} size="xl" />
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
            <Loader2 className="h-5 w-5 animate-spin text-white" strokeWidth={2} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{name}</p>
          <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary btn-sm"
          >
            <Camera className="h-3.5 w-3.5" strokeWidth={2} />
            {photoUrl ? "Trocar foto" : "Adicionar foto"}
          </button>
          {photoUrl && (
            <button type="button" onClick={handleRemove} disabled={uploading} className="btn-ghost btn-sm">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Remover
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <p className="text-xs text-neutral-400 dark:text-neutral-500">JPEG, PNG ou WebP · até 10MB.</p>
      </div>
    </div>
  );
}
