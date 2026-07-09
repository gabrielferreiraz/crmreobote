import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2";
import { ProfileAvatarForm } from "./profile-avatar-form";

export default async function PerfilPage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { id: true, name: true, email: true, image: true },
  });
  const photoUrl = await resolveAvatarUrl(user?.image);

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Perfil e preferências</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Sua foto e informações de conta.</p>
      </div>
      <div className="card p-4">
        <ProfileAvatarForm userId={user!.id} name={user!.name} email={user!.email} photoUrl={photoUrl} />
      </div>
    </div>
  );
}
