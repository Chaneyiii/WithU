const GENERIC_NOTIFICATION = Object.freeze({ title: 'Withu', body: 'You have an update.' });

async function showProactivityNotification({ Notification, eligible, appRunning, preview = false, onClick }) {
  if (preview) return 'test_preview';
  if (!eligible) return 'suppressed_policy';
  if (!appRunning) return 'suppressed_app_stopped';
  if (typeof Notification !== 'function' || !Notification.isSupported?.()) return 'not_supported';
  // Never hard-block on `permission`: Electron on Windows reports 'denied' in
  // situations where notifications still work, so refusing to even try would
  // silently swallow every reminder. Attempt first, then label honestly.
  const permissionDenied = Notification.permission === 'denied';

  let notification;
  try {
    notification = new Notification(GENERIC_NOTIFICATION);
  } catch {
    return 'failed';
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => finish(permissionDenied ? 'suppressed_permission' : 'unconfirmed'), 5000);
    // Clicking the toast must bring Withu back: focusing the window is the
    // minimum honest behaviour, and it needs no renderer cooperation.
    notification.once('click', () => { try { onClick?.(); } catch {} });
    notification.once('show', () => finish('shown_by_os'));
    notification.once('failed', () => finish(permissionDenied ? 'suppressed_permission' : 'failed'));
    try {
      notification.show();
    } catch {
      finish('failed');
    }
  });
}

async function settleInterruptedNotifications({ owner, appRunning }) {
  if (!owner?.ready || !appRunning()) return;
  const entries = (await owner.request('withu:proactivity:feed_list')).items;
  for (const entry of entries.filter(item => item.notification_status === 'pending')) {
    if (!owner?.ready || !appRunning()) return;
    await owner.request('withu:proactivity:notification_result', {
      candidate_id: entry.candidate_id,
      expected_version: entry.notification_version,
      status: 'unconfirmed',
    }).catch(() => {});
  }
}

module.exports = { showProactivityNotification, settleInterruptedNotifications };
