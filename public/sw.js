self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "CRM", body: event.data.text() };
  }

  const title = data.title || "CRM";
  const options = {
    body: data.body || "",
    icon: "/icons/192",
    badge: "/icons/192",
    data: { url: data.url || "/", reminderId: data.reminderId || null },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = Boolean(data.renotify);
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  const reminderId = event.notification.data?.reminderId;
  const acknowledge = reminderId
    ? fetch(`/api/push/reminders/${encodeURIComponent(reminderId)}/open`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
      }).catch(() => undefined)
    : Promise.resolve();

  event.waitUntil(
    Promise.all([
      acknowledge,
      self.clients.matchAll({ type: "window" }).then((clientList) => {
        // Compara só o pathname, não a URL absoluta — client.url inclui origin
        // (e às vezes querystring/hash de navegação) então "== url" quase nunca
        // batia, mesmo com a aba certa já aberta, e sempre abria uma aba nova.
        const targetPath = new URL(url, self.location.origin).pathname;
        for (const client of clientList) {
          if ("focus" in client && new URL(client.url).pathname === targetPath) {
            client.focus();
            if ("navigate" in client) client.navigate(url);
            return;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
    ]),
  );
});
