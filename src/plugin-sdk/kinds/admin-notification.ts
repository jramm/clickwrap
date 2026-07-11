/**
 * `admin-notification` plugin kind: notify admins/operators about noteworthy events (the first
 * trigger is a customer objection / "Widerspruch"). Several notifiers can be ACTIVE at once (env
 * `ADMIN_NOTIFICATIONS`, ordered, like `ADMIN_AUTH`); the host fans a single {@link AdminNotification}
 * out to all of them and isolates failures per notifier — a broken Slack/HubSpot call must never
 * block the business action that produced the notification.
 *
 * Contract: `notify` is best-effort and should resolve even on a transport error (log + return);
 * the host additionally wraps each call in try/catch so one failing notifier cannot affect others.
 */

/** The events that can trigger an admin notification (extend as more triggers are added). */
export type AdminNotificationEvent = 'OBJECTION_RAISED';

/**
 * A transport-agnostic admin notification. `title`/`body` are ready-to-use plain text for simple
 * transports (e-mail, Slack); the structured fields let richer transports (e.g. a HubSpot ticket)
 * build their own representation.
 */
export interface AdminNotification {
  event: AdminNotificationEvent;
  /** Short one-line summary (e-mail subject / Slack heading / ticket subject). */
  title: string;
  /** Human-readable details as plain text (newline-separated). */
  body: string;
  customerId: string;
  customerName?: string;
  versionId: string;
  versionLabel?: string;
  documentType?: string;
  audience?: string;
  /** Free-text reason the customer gave (objection reason), when present. */
  reason?: string;
  /** ISO-8601 timestamp of the underlying event. */
  occurredAt: string;
}

export interface AdminNotifier {
  /**
   * Deliver the notification. Best-effort: implementations should catch their own transport errors
   * (log and return) rather than throw; the host also isolates failures per notifier.
   */
  notify(notification: AdminNotification): Promise<void>;
}
