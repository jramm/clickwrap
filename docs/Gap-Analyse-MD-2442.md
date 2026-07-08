# Gap-Analyse: MD-2442 „Contract Amendment Consent Management" vs. clickwrap-server

**Stand:** 08.07.2026 · **Quellen:** Epic MD-2442 (Beschreibung + Kommentare Saskia/Michael, Stand 08.07.),
Story-Sheet (49 nummerierte + 2 unnummerierte Stories mit Priorität), clickwrap-server Commit `332adc9`
(Backend 744 Tests, Admin-UI 30 Tests, grün).

---

## 1. Kurzfazit

**Der fachliche Kern des Epics ist im clickwrap-server bereits gebaut und getestet.** Von den P1-Stories
des Kern-Flows (Anlegen, Modi, Zustimmung, Login-freier Link, Nachweis) sind fast alle vollständig
abgedeckt — inklusive zweier Punkte, die das Epic erst als „Future Iteration" führt (unabhängige
Vertragstypen, Story 40; manueller Link-Versand, Story 43). **Die echten Lücken liegen an den Rändern:**
Export (PDF/CSV), FAQ-/Support-Strecke, konfigurierbare Reminder-Leiter & Eskalations-Konsequenzen,
E-Mail-Template-Verwaltung, Open-Tracking/Bounce-Liste als Admin-Views sowie die komplette
CRM-/HubSpot-Integration.

**Bilanz über alle 49 nummerierten Stories:**

| Status | Anzahl | Anteil |
|---|---|---|
| ✅ Vollständig abgedeckt | 18 | ~37 % |
| 🟡 Teilweise (Daten/Mechanik da, Sicht/Feinsteuerung fehlt) | 12 | ~24 % |
| ❌ Fehlt | 16 | ~33 % |
| ➖ Kein Software-Gap (Prozess/Doku) | 3 | ~6 % |

Gewichtet man nach Priorität, ist das Bild besser: von den **31 P1-Stories** sind 15 ✅, 8 🟡, 8 ❌ —
und die ❌-P1s konzentrieren sich auf Export, Templates, Reminder-Konfiguration und CRM.

---

## 2. Abdeckung im Detail (je Sheet-Kategorie)

### 2.1 Anlegen & Information (Stories 1–6)

| Nr | P | Story (Kurzform) | Status | clickwrap-server |
|---|---|---|---|---|
| 1 | 1 | Anpassung anlegen, Vertragswerk als Anhang, Info via Plattform + E-Mail | ✅ | Dokument/Version-Upload (PDF), Publish → Rollout-States + E-Mail-Versand; Portal-Popup via Pending-API |
| 2 | 2 | Versionierter Upload mit Versionsnummer + Gültigkeitsdatum | ✅ | `versionLabel` + `validFrom`, Historie je Dokument |
| 3 | 3 | Draft → Review → Live | 🟡 | DRAFT→PUBLISHED (bewusster 2-Schritt, DRAFT editier-/löschbar); **kein 4-Augen-Freigabe-Workflow** (Review-Rolle) |
| 4 | 3 | Interne Notiz bei Aktivierung | 🟡 | `changeSummary` existiert, ist aber **kundensichtbar** (Popup-Text); separates internes Notizfeld fehlt (klein) |
| 5 | 1 | E-Mail-Benachrichtigung vor Pflicht-Dialog | ✅ | Rollout-Mails beim Publish (Postmark-Plugin) |
| 6 | 4 | Einblende-Datum mit Vorlauf | ✅ | Zukunfts-`validFrom` (Vorab-Akzeptanz, gerade gebaut): Publish-Zeitpunkt steuert Sichtbarkeit, `validFrom` die Wirksamkeit |

### 2.2 Wahl der Zustimmung & aktive Zustimmung (7–15)

| Nr | P | Story | Status | Anmerkung |
|---|---|---|---|---|
| 7 | 1 | Aktive Zustimmung vs. Widerspruchsfrist x Tage | ✅ | `acceptanceMode ACTIVE/PASSIVE` + `objectionPeriodDays` je Version |
| 8 | 1 | Dialog mit lesbarem Vertragstext/Link | ✅ | Pending-API (Popup-Kontrakt) + Hosted Page; PDF-Link presigned |
| 9 | 1 | Nur aktive Handlung (Checkbox + Bestätigung) | ✅ | `consentText`-Checkbox, serverseitige Gegenprüfung, kein implizites Zustimmen |
| 10 | 1 | Soft/Hard Block konfigurierbar | ✅ | Pending = Soft (Banner portal-seitig), `gracePeriodDays` je Version → `EXPIRED_BLOCKING` = Hard; Compliance-Gate-API |
| 11 | 1 | Inaktive Kunden nach X Tagen automatisch mailen | 🟡 | Wir mailen **alle** beim Rollout + Reminder — Ziel (Inaktive erreichen) erfüllt, „nur Inaktive nach X Tagen"-Feinsteuerung fehlt |
| 12 | 1 | Signierter Link ohne Login | ✅ | Hosted Acceptance Page (Token-Link, Kanal `LINK`, selbst-deklarierte Identität) |
| 13 | 1 | Link-Gültigkeit (30 Tage) + Neuanforderung | ✅ | `expiresInDays` (Default 30, max 365), Revocation im Repo; Admin mintet jederzeit neu |
| 14 | 1 | Zustellstatus je Kunde: delivered / bounced / **geöffnet** | 🟡 | Delivered + Bounced getrackt (Webhook + Fallback-Polling); **Open-Tracking fehlt** (Postmark könnte es liefern); Sicht je Kunde: Notifications in der Historie |
| 15 | 1 | Separate Bounce-Liste | 🟡 | Bounces landen im EscalationLog inkl. `inactivated_email` — **Admin-View/Endpoint dafür fehlt** |

### 2.3 Nachweis (16–19)

| Nr | P | Story | Status | Anmerkung |
|---|---|---|---|---|
| 16 | 1 | Audit-Log je Kunde (Zeit, IP, User, Version) | ✅ | `GET /admin/customers/:id/history` mit vollständiger Evidence |
| 17 | 1 | Zugestimmten Text immutable archivieren | ✅ | Versionen + PDFs immutable, `contentHash` + `consentText`-Snapshot am Nachweis |
| 18 | 1 | **Export PDF/CSV** (einzeln/gesamt) | ❌ | Bewusst deferred; Daten vollständig vorhanden |
| 19 | 1 | E-Mail-Link-Zustimmung lückenlos dokumentiert | ✅ | Kanal `LINK` mit IP/UA/Zeit/Version/consentText + Transparenzvermerk |

### 2.4 FAQ & Support (20–28) — größte zusammenhängende Lücke

| Nr | P | Story | Status |
|---|---|---|---|
| 20–22 | 2–3 | FAQ je Vertragsanpassung anlegen/pflegen/reviewen, versionsgebunden | ❌ |
| 23 | 3 | FAQ-Link in E-Mail + Plattform | ❌ (trivial, sobald FAQ existiert — oder externer Link im Template) |
| 24 | 3 | Support-Anfrage direkt aus dem Dialog | ❌ |
| 25 | 3 | No-Reply-Hinweis | 🟡 (E-Mail-Texte vorhanden, Absender-/Reply-Konfig via `EMAIL_FROM`; Hinweistext = Template-Thema) |
| 26, 28 | – | Dedizierte Support-Queue, FAQ-Eskalation an Legal | ❌ (eher Ticketsystem-Integration als clickwrap-Kern) |
| 27 | – | Consent-Status beim Bearbeiten einer Anfrage sehen | 🟡 (per Compliance-/History-API oder Admin-UI abrufbar; keine Ticketsystem-Einbettung) |

### 2.5 Opt-Out-Mitteilung (29–33)

| Nr | P | Story | Status | Anmerkung |
|---|---|---|---|---|
| 29 | 1 | Mitteilung ohne aktive Zustimmung, mit Widerspruchsrecht | ✅ | PASSIVE-Modus (stillschweigende Annahme nach Frist, TACIT via Sweeper) |
| 30 | 1 | Klarer Hinweis auf Recht, Frist, Konsequenz | ✅ | Hosted Page + Pending-Payload liefern Frist/Modus; Portal-Wording portal-seitig |
| 31 | 1 | Einspruch **nur mit Begründung** | 🟡 | Objection-API vorhanden, `reason` ist aktuell **optional** → Pflicht machen (klein) |
| 32 | 1 | Bestätigung nach Einspruch (E-Mail + Plattform) | 🟡 | API-Bestätigung ja; **Bestätigungs-E-Mail fehlt** |
| 33 | 2 | Einspruch-Queue + Eskalation an Legal | 🟡 | `OBJECTED`-Filter in der Overview + Resolution-Feld; dedizierter Queue-Workflow fehlt |

### 2.6 Steuerung / „Legal-Dashboard" (34–39)

| Nr | P | Story | Status | Anmerkung |
|---|---|---|---|---|
| 34 | 1 | **Reminder-Rhythmus konfigurierbar** (7/14/28) | 🟡 | Reminder existieren (fest: 7 + 2 Tage **vor** Frist); konfigurierbare Leiter je Anpassung fehlt |
| 35 | 1 | **Konsequenz nach Fristablauf konfigurierbar** (Block / AM-Benachrichtigung / Eskalations-Task) | 🟡 | Block ✅ (ACTIVE→EXPIRED_BLOCKING); Benachrichtigungs-/Task-Konsequenzen fehlen |
| 36 | 1 | **E-Mail-Vorlagen zentral verwalten** | ❌ | Texte sind im Code (Template-Verwaltung im Admin fehlt) |
| 37 | 1 | Dashboard je Version: zugestimmt/ausstehend **nach Kanal** | 🟡 | Overview-Matrix + Filter ✅; Kanal-Aufschlüsselung + Quoten-Kacheln fehlen (Daten vorhanden: `method`/`channel` je Acceptance) |
| 38 | 1 | Segment-Filter (letzter Login, Vertragsgröße, Kundentyp) | ❌ | Solche Segmentdaten kennt der Service nicht (bewusst schlank); Basis-Filter existieren |
| 39 | 1 | Offene Zustimmungsquote | 🟡 | Zählbar aus Overview (`total` + Filter); Quote als Kennzahl trivial nachrüstbar |

### 2.7 Future-Sektion des Sheets (40–43) — teilweise schon erledigt

| Nr | P | Story | Status | Anmerkung |
|---|---|---|---|---|
| 40 | 3 | **Unabhängige Vertragstypen** (AVV/AGB/Datenschutz getrennt versionieren) | ✅ **bereits gebaut** | Dynamische Dokumenttypen × Zielgruppen, unabhängig versioniert — im Epic als Future geführt, bei uns Kern |
| 42 | – | Postalischer Nachweis-Export | ❌ | Auch im Epic explizit ungescoped |
| 43 | 1 | Manueller Link-Versand durch Support | ✅ (Kern) | Admin mintet + kopiert Link jederzeit (Overview-Action); „Versand" erfolgt manuell — dedizierter Resend-Button mit Mail wäre klein |

### 2.8 CRM/HubSpot & Kommunikation (44–49 + unnummeriert) — zweite große Lücke

| Nr | P | Story | Status | Anmerkung |
|---|---|---|---|---|
| 44 | 1 | Button-Ziel der Zustimmungs-E-Mail festlegen | 🟡 | Ziel ist heute die Hosted Page (sinnvoller Default); konfigurierbar (Landingpage/Login-Wall) fehlt |
| 45 | 1 | Auto-Link-Erneuerung bei Ablauf für Reminder | ❌ | Reminder verlinken heute nicht automatisch einen frischen Token-Link |
| 46 | 1 | Consent-Status als HubSpot-Property | ❌ | Kein HubSpot-Push; Integration-API vorhanden (Pull möglich), Property-Sync fehlt |
| 47 | 1 | Individuelle Deadline als HubSpot-Property/Workflow-Trigger | ❌ | CRM-seitig; `deadlineAt` je Kunde×Version liefert die API |
| 48 | 1 | Playbook bei Nicht-Zustimmung/Widerspruch | ➖ | Prozess-/Orga-Thema, kein Software-Gap im Service |
| 49 | 1 | Empfänger je Company festlegen (Primary/Vertretungsberechtigter) | 🟡 | `contactEmails[]` vorhanden (alle werden gemailt); **dedizierter „vertretungsberechtigter Empfänger"** als Feld fehlt (klein) |
| – | – | Versand in Tranchen | ❌ | Kohorten-Rollout war bei uns konzipiert (Go-Live-Werkzeuge), aber nicht implementiert |
| – | – | Vertretungsberechtigte identifizieren | ➖/🟡 | Orga-Thema + Feld aus 49 |

---

## 3. Die offenen Kommentar-Fragen im Epic — Stand bei uns

**Saskia F1 („Wer bestätigt? Alle einzeln oder eine:r pro Provider-Gruppe, rollengebunden?"):**
Bei uns entschieden (OF-A1): Akzeptanz gilt **kundenweit** (Company), ausführen darf **jeder Portal-User**;
die Portal-Rolle des Users wird im Nachweis mitprotokolliert. Michaels Vorschläge sind bei uns teilweise
schon da: Namensfeld + Transparenzhinweis existieren auf der Hosted Page (selbst-deklarierte Identität);
„vertretungsberechtigt"-Hinweistexte in Portal-Dialog und E-Mail sind reine Textbausteine; eine
**Manager-only-Restriktion** wäre eine kleine Erweiterung des ServiceGuard-Kontrakts (Portal liefert die
Rolle bereits im Auth-Kontext — der Service müsste sie nur validieren, konfigurierbar je Anpassung).

**Saskia F2 / Michael („Wo lebt die Konfiguration? Legal-Dashboard passt nicht ins Admin-Portal"):**
Genau das löst die clickwrap-server-Architektur: eigener Service mit eigenem Admin-UI (Google-SSO),
unabhängig vom bestehenden Admin-Portal. Michaels reduzierte Dashboard-Definition („Liste der
Dokumentänderungen, Detailseite mit Dokument/Konfig, Akzeptanz-Tabelle über Provider-Gruppen") **existiert
bereits**: Documents-Seite, Versions-Detail, Overview-Matrix mit Filtern.

---

## 4. Priorisierte Gap-Liste (nur echte Lücken, mit Aufwandsschätzung)

| # | Gap | Stories | Aufwand* | Bemerkung |
|---|---|---|---|---|
| G1 | **Nachweis-Export PDF/CSV** | 18 | S–M | Daten komplett da; CSV je Version/Kunde + PDF-Beweisdokument |
| G2 | **Reminder-Leiter + Konsequenzen konfigurierbar** je Anpassung | 34, 35, 11 | M | Felder an Version/Policy + Sweeper-Erweiterung; AM-Benachrichtigung braucht Empfänger-Konzept |
| G3 | **E-Mail-Template-Verwaltung** im Admin | 36, 25 | M | Alternativ minimal: Templates als konfigurierbare Texte je Anpassung |
| G4 | **Bounce-Liste + Zustellstatus-Ansicht** (Admin), Open-Tracking | 14, 15 | S–M | EscalationLog-Endpoint + UI-Tab; Open-Tracking via Postmark-Webhook (`Open`-Events) |
| G5 | **Einspruch: Pflicht-Begründung + Bestätigungs-Mail + Queue-Ansicht** | 31, 32, 33 | S | Kleinteilig, Mechanik vorhanden |
| G6 | **Kanal-Aufschlüsselung + Quoten im Dashboard** | 37, 39 | S | Aggregation vorhandener Daten |
| G7 | **Auto-Link-Erneuerung in Remindern** (frischer Token-Link in jeder Reminder-Mail) | 45, 13 | S | Reminder-Service mintet Link vor Versand |
| G8 | **HubSpot-Sync** (Consent-Status + Deadline als Properties) | 46, 47 | M–L | Eigenes Sync-Modul/Job gegen HubSpot-API; alternativ Pull-Integration per bestehender API |
| G9 | **Empfänger-Steuerung** (vertretungsberechtigter Primärkontakt je Company) | 49, Kommentare | S | Feld + Versand-/Hinweislogik; ggf. Manager-only-Zustimmung (Guard-Erweiterung) |
| G10 | **FAQ-Strecke** (Anlage je Anpassung, Links in Mail/Popup) | 20–23 | M | Oder pragmatisch: externer FAQ-Link (z. B. Notion/Website) als Feld je Version — dann S |
| G11 | **Support-Queue/-Integration** | 24, 26–28, 33 | L/extern | Empfehlung: Ticketsystem (Zammad o. ä.) + Consent-Status per API einblenden, nicht nachbauen |
| G12 | **Tranchen-/Kohorten-Rollout** | unnr. | M | War als Go-Live-Werkzeug bereits konzipiert |
| G13 | Interne Notiz + Review-Workflow für Versionen | 3, 4 | S | Feld + optionaler 4-Augen-Publish |
| G14 | Postalischer Export | 42 | – | Wie im Epic: erst Stakeholder-Input |

\* S ≈ ein Agent-Durchlauf/Tag, M ≈ mehrere, L ≈ größer bzw. externe Abhängigkeit.

---

## 5. Was der clickwrap-server ÜBER das Epic hinaus mitbringt

- **Zwei Zielgruppen** (Betreiber **und** Partner) mit unabhängigen Gates — das Epic denkt nur Betreiber.
- **Integration API** (Service-zu-Service) für Portal-Popup, Compliance-Gate, Kunden-Onboarding — sauber
  getrennte OpenAPI-Specs + kubb-generierte Clients.
- **Signed-Offer-Import** (`acceptedVersions` beim Kundenanlegen, rückdatierbar, Angebots-Referenz als
  Beweis) + **statischer PDF-Link** je Dokument für Angebote — zusammen der komplette
  HubSpot-Angebots-Loop.
- **Vorab-Akzeptanz** (Zukunfts-`validFrom` mit automatischem Flip, Fristanker-Schutz).
- **Plugin-System** (E-Mail/Storage/Admin-Auth via npm-Discovery, u. a. SuperTokens-Auth fertig).
- **Beweisketten-Härtung** aus zwei adversarialen Reviews (serverseitiger consentText, atomare
  State-Übergänge, kein Widerspruchs-Schlupfloch, Block-Carry-over).
- Apache-2.0, englisch, 744 + 30 Tests.

---

## 6. Handlungsoptionen

1. **Epic auf clickwrap-server aufsetzen (Empfehlung):** Die ✅/🟡-Basis übernehmen, die Gap-Liste
   (G1–G13) als Stories unter MD-2442 anlegen, Wireframes/BPMN gegen den Ist-Stand abgleichen. Vermeidet
   eine Parallelentwicklung von ~70 % bereits gebauter (und review-gehärteter) Funktionalität.
2. **Nur Gap-Mapping ins Epic kommentieren** und die Scoping-Diskussion dem Team überlassen.
3. **Gaps direkt wegbauen** (G1, G4–G7, G9, G13 sind zusammen gut in 1–2 Agent-Wellen machbar; G2/G3/G8
   als zweite Welle) und dann mit fast vollständiger Epic-Abdeckung in die Team-Diskussion gehen.

*Nicht bewertet mangels Zugriff: Hi-Fi-Wireframe (Claude-Design-Link) und BPMN-PDFs (Drive-Ordner ist
owner-only — im Epic selbst als Problem vermerkt). Die Screens L1/L2/K1–K3 sind aus der Epic-Beschreibung
abgeleitet berücksichtigt.*
