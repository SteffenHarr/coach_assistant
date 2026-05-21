"""Deterministic, low-cost chat assistant.

Replaces the LLM-backed agent. Answers every common question about the
Coach Assistant via keyword matching against a large static knowledge
base, plus live DB queries.

Resolution order in :func:`answer`:
  1. Live-data intents (need DB).
  2. Static knowledge base (matched topic by topic, first match wins).
  3. Greeting heuristic.
  4. Topic suggestions (closest topics by keyword overlap).
  5. Help fallback.

Sub-10ms response time, no GPU/CPU spike. German-first matching.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from coach_api.infrastructure.models import (
    CoachORM,
    CourtORM,
    PlanORM,
    PlayerORM,
    SeasonORM,
    UserORM,
)


# ---------- Static knowledge base ----------


@dataclass(slots=True)
class Topic:
    """A single knowledge entry.

    Matched if the message contains AT LEAST ONE of the `keywords` AND,
    if `requires` is given, at least one keyword from each of those
    additional groups (logical AND of OR-groups).
    """

    title: str
    keywords: set[str]
    answer: str
    requires: list[set[str]] = field(default_factory=list)


# IMPORTANT: more specific topics MUST come first — first match wins.
KNOWLEDGE: list[Topic] = [
    # ---------- Meta / help ----------
    Topic(
        title="Hilfe-Index",
        keywords={"hilfe", "help", "menu", "menü", "themen", "übersicht", "uebersicht", "was kannst du", "what can you", "befehle"},
        answer=(
            "Ich beantworte Fragen rund um den Coach Assistant. Themen, die "
            "ich abdecke:\n\n"
            "**📊 Daten abfragen**\n"
            "• „Welche Trainer/Spieler/Plätze/Saisons haben wir?"\n"
            "• „Wie viele Benutzer gibt es?"\n"
            "• „Zeig mir die letzten Pläne"\n\n"
            "**📅 Pläne**\n"
            "• „Wie erstelle ich einen Plan?"\n"
            "• „Wie vergleiche ich zwei Pläne?"\n"
            "• „Was ist der Saisonwechsel?"\n"
            "• „Was bedeutet der Plan-Score?"\n\n"
            "**🧠 Solver**\n"
            "• „Wie funktioniert der Solver?"\n"
            "• „Was sind harte/weiche Constraints?"\n"
            "• „Warum ist mein Plan leer/infeasible?"\n\n"
            "**👥 Benutzer & Rollen**\n"
            "• „Wie lege ich einen Trainer/Spieler an?"\n"
            "• „Was darf Admin/Trainer/Spieler?"\n"
            "• „Wie ändere ich ein Passwort?"\n\n"
            "**🎾 Tennis-Konzepte**\n"
            "• „Was bedeutet LK?", „Was ist Spielstärke?"\n"
            "• „Was sind Gruppengrößen?"\n\n"
            "**⏰ Verfügbarkeit & Profil**\n"
            "• „Wie ändere ich meine Verfügbarkeit?"\n"
            "• „Wie ändere ich mein Profil?"\n\n"
            "**🔒 Datenschutz & Betrieb**\n"
            "• „Wie exportiere ich meine Daten?"\n"
            "• „Wie lösche ich mein Konto?"\n"
            "• „Wie wird ein Backup gemacht?"\n\n"
            "Schreibe einfach eine Frage — ich erkenne die Stichworte."
        ),
    ),
    Topic(
        title="Über den Bot",
        keywords={"wer bist du", "was bist du", "bist du eine ki", "bist du ein bot", "llm", "chatgpt", "gpt", "ki?", "ai?"},
        answer=(
            "Ich bin **kein** Sprachmodell, sondern ein deterministischer "
            "Regel-Bot. Ich erkenne Stichworte und liefere fest hinterlegte "
            "Antworten oder Live-Daten aus der Datenbank. Vorteil: blitzschnell, "
            "keine Halluzinationen, kein GPU-Bedarf. Nachteil: ich kann nur "
            "Themen beantworten, die ich kenne — tippe **hilfe** für die Liste."
        ),
    ),

    # ---------- Tennis concepts ----------
    Topic(
        title="LK / Leistungsklasse",
        keywords={"lk", "leistungsklasse", "spielstärke", "spielstaerke", "ranking", "level"},
        answer=(
            "**LK = Leistungsklasse** (deutsche Tennis-Skala 1–25).\n"
            "• LK 1 = Profi/Top-Spieler\n"
            "• LK 25 = absoluter Anfänger\n\n"
            "Im Coach Assistant:\n"
            "• Die LK eines Spielers setzt **nur ein Trainer** "
            "(Reiter *Spieler → Liste*, Inline-Editor in der LK-Spalte).\n"
            "• Trainer hinterlegen in ihrem Profil, welchen LK-Bereich sie "
            "trainieren (`accepts_lk_min`/`accepts_lk_max`). Der Solver "
            "kombiniert dann nur passende Trainer mit Spielern."
        ),
    ),
    Topic(
        title="Saison",
        keywords={"saison", "season", "halbjahr", "trainingsperiode", "periode"},
        answer=(
            "Eine **Saison** ist eine Trainingsperiode (z.B. „Sommer 2026"). "
            "Pro Saison wird **ein wöchentlicher Plan** erstellt, der sich "
            "Woche für Woche wiederholt, bis die Saison endet.\n\n"
            "Felder einer Saison: Name, `valid_from`, `valid_to`. Beim "
            "**Saisonwechsel** erstellst du einen neuen Plan mit "
            "aktualisierten Verfügbarkeiten."
        ),
    ),
    Topic(
        title="Gruppengröße",
        keywords={"gruppengröße", "gruppengroesse", "gruppe", "gruppen", "max_group", "1er", "2er", "einzeltraining", "gruppentraining"},
        answer=(
            "Eine **Gruppe** ist die Teilnehmerzahl einer Session.\n"
            "• 1 = Einzeltraining\n"
            "• 2 = Doppel-/Zweier-Gruppe\n"
            "• 3–4 = klassisches Gruppentraining\n\n"
            "Jeder Trainer hat in seinem Profil ein `max_group_size` (z.B. 4). "
            "Der Solver darf für diesen Trainer keine Gruppe größer als "
            "`max_group_size` planen."
        ),
    ),
    Topic(
        title="Slot / Zeitraster",
        keywords={"slot", "slots", "zeitraster", "raster", "30 min", "30-min", "halbstunde", "zeitschiene"},
        answer=(
            "Die App rechnet intern in **30-Minuten-Slots**. Ein Trainingstag "
            "hat 30 Slots (06:00–21:00 = 15 h × 2). Eine ganze Trainingswoche "
            "hat **210 Slots** (7 Tage × 30 Slots).\n\n"
            "Für dich als Nutzer: du gibst alle Werte in **Stunden** ein "
            "(z.B. „min 1 h, max 6 h pro Tag"); die App rechnet das intern in "
            "Slots um."
        ),
    ),

    # ---------- Plan ----------
    Topic(
        title="Plan erstellen / Saisonwechsel",
        keywords={"saisonwechsel", "neuen plan", "plan erstellen", "plan generieren", "plan rechnen", "wizard", "replan"},
        answer=(
            "**Plan erstellen** (Reiter *Pläne → Saisonwechsel*):\n"
            "1. Saison auswählen (oder neu anlegen).\n"
            "2. Eingangsdaten prüfen: alle Trainer/Spieler haben Verfügbarkeit?\n"
            "3. Solver starten — er erzeugt bis zu **3 Plan-Varianten**.\n"
            "4. Variante mit höchstem Score auswählen → **Aktivieren**.\n"
            "5. Optional: alten und neuen Plan **vergleichen** "
            "(Reiter *Pläne → Vergleichen*).\n\n"
            "Der Plan ist immer **wöchentlich wiederkehrend**. Eine Änderung "
            "bedeutet immer einen neuen Plan, nicht das Editieren des alten."
        ),
    ),
    Topic(
        title="Plan vergleichen",
        keywords={"vergleich", "compare", "diff", "unterschied", "alt vs neu", "alt und neu"},
        answer=(
            "**Pläne vergleichen** (Reiter *Pläne → Vergleichen*):\n"
            "• Wähle zwei Pläne (z.B. alter aktiver Plan vs. neue Variante).\n"
            "• Du siehst:\n"
            "   – ➕ neue Sessions, die nur in Plan B sind\n"
            "   – ➖ entfallene Sessions, die nur in Plan A sind\n"
            "   – ✅ unveränderte Sessions\n"
            "   – Δ Workload pro Trainer (Stunden/Woche)\n"
            "Hilfreich vor dem Aktivieren: prüfen, was sich für die Spieler ändert."
        ),
    ),
    Topic(
        title="Plan-Score",
        keywords={"score", "punktzahl", "bewertung", "qualität", "qualitaet", "best"},
        answer=(
            "Der **Score** ist die Zielfunktion des Solvers. Höher = besser.\n"
            "Er setzt sich zusammen aus:\n"
            "• **+ erfüllte Trainerwünsche** der Spieler\n"
            "• **+ erfüllte Mitspieler-Wünsche**\n"
            "• **+ minimale Platzwechsel** (zusammenhängende Blocks)\n"
            "• **+ erfüllte Mindest-/Wunsch-Stundenzahl der Spieler**\n\n"
            "Der Plan mit dem höchsten Score wird in der Liste als **„bester "
            "Plan"** markiert."
        ),
    ),
    Topic(
        title="Plan aktivieren",
        keywords={"aktivier", "veröffentlich", "veroeffentlich", "live schalten", "scharf"},
        answer=(
            "Ein Plan ist erst nach **Aktivieren** der gültige Wochenplan. "
            "In der Plan-Liste (Reiter *Pläne*): Klick auf den Plan, dann "
            "**Aktivieren**. Es kann pro Saison nur ein aktiver Plan "
            "gleichzeitig existieren — der vorherige wird automatisch "
            "deaktiviert (bleibt aber als Historie erhalten)."
        ),
    ),
    Topic(
        title="Plan-Detailansicht",
        keywords={"plan detail", "plandetail", "plan ansehen", "plan öffnen", "plan oeffnen", "wochenplan"},
        answer=(
            "Klick auf einen Plan in der Liste → **Detailansicht** "
            "(`/plans/{id}`). Du siehst:\n"
            "• Wochenraster mit allen Sessions (Mo–So × 06:00–21:00)\n"
            "• Pro Session: Trainer, Spieler, Platz, Dauer\n"
            "• Kennzahlen: Score, Anzahl Sessions, Auslastung pro Trainer\n"
            "• Buttons: Aktivieren, Vergleich starten, Export"
        ),
    ),

    # ---------- Solver ----------
    Topic(
        title="Solver-Funktionsweise",
        keywords={"solver", "or-tools", "ortools", "cp-sat", "optimierung", "optimization", "algorithmus", "algorithm"},
        answer=(
            "Der **Solver** verwendet Google **OR-Tools CP-SAT** "
            "(Constraint Programming + SAT). Er sucht aus Milliarden möglicher "
            "Wochenpläne den mit höchstem Score, der **alle harten "
            "Constraints** erfüllt.\n\n"
            "**Harte Constraints** (müssen erfüllt sein):\n"
            "• Verfügbarkeit Trainer/Spieler/Platz\n"
            "• Gruppengrößen (`max_group_size`)\n"
            "• Mindest-Block-Länge (zusammenhängende Slots)\n"
            "• Max. Stunden/Tag und /Woche pro Trainer und Spieler\n"
            "• Akzeptierte LK & Altersgruppen des Trainers\n\n"
            "**Soft-Objektive** (zu maximieren):\n"
            "• erfüllte Trainer- und Mitspieler-Wünsche\n"
            "• wenig Platzwechsel\n"
            "• Mindest-/Wunschstunden der Spieler erreichen"
        ),
    ),
    Topic(
        title="Constraint-Arten",
        keywords={"hart", "weich", "soft", "harte constraints", "weiche constraints", "constraint", "constraints", "einschränkung", "einschraenkung"},
        answer=(
            "Der Solver kennt zwei Arten von Regeln:\n\n"
            "**Harte Constraints** = MÜSSEN erfüllt sein, sonst wird der Plan "
            "verworfen. Beispiele: niemand ist gleichzeitig auf zwei Plätzen, "
            "kein Spieler bekommt einen Trainer, dessen LK-Bereich er "
            "verfehlt, kein Trainer überschreitet seine Maximalstunden.\n\n"
            "**Weiche Constraints (Soft-Objektive)** = SOLLEN möglichst "
            "erfüllt werden, fließen in den Score ein. Beispiele: "
            "Wunschtrainer erfüllen, Lieblings-Mitspieler paaren, "
            "Platzwechsel minimieren."
        ),
    ),
    Topic(
        title="Plan leer / infeasible",
        keywords={"infeasible", "leer", "keine sessions", "kein plan", "warum keine", "solver findet nichts", "unmöglich", "unmoeglich"},
        answer=(
            "Wenn der Solver einen leeren oder „infeasible" Plan meldet, sind "
            "die harten Constraints widersprüchlich. Häufige Ursachen:\n\n"
            "1. **Zu wenig Verfügbarkeit** — Trainer/Spieler/Platz haben "
            "kein gemeinsames Zeitfenster.\n"
            "2. **LK-Lücke** — kein Trainer akzeptiert die LK-Stufen der "
            "Spieler.\n"
            "3. **Min-Stunden zu hoch** — Spieler verlangen mehr Stunden, "
            "als zusammen passen.\n"
            "4. **Plätze zu knapp** — zu wenige Courts für die Slot-Zahl.\n\n"
            "Lösung: Reiter *Verfügbarkeiten* öffnen, Lücken füllen, "
            "Min-Stunden senken oder zusätzlichen Platz/Trainer anlegen."
        ),
    ),
    Topic(
        title="Solver-Laufzeit",
        keywords={"solver dauert", "solver langsam", "wie lange", "laufzeit", "rechenzeit", "timeout"},
        answer=(
            "Typische Solver-Laufzeit:\n"
            "• Kleine Vereine (≤10 Trainer, ≤30 Spieler): **<10 Sekunden**.\n"
            "• Mittelgroß (≤20 Trainer, ≤80 Spieler): **30–120 Sekunden**.\n"
            "• Groß (≥30 Trainer, ≥150 Spieler): **2–10 Minuten**.\n\n"
            "Der Solver läuft im **Worker-Container** (asynchron), die UI "
            "blockiert nicht. Bei harter Zeitbegrenzung liefert der Solver "
            "die beste bisher gefundene Lösung."
        ),
    ),

    # ---------- Roles ----------
    Topic(
        title="Rollen-Übersicht",
        keywords={"rolle", "rollen", "rechte", "berechtigung", "wer darf", "role", "permission", "permissions"},
        answer=(
            "Es gibt drei Rollen:\n\n"
            "**👑 Admin** — voller Zugriff:\n"
            "• Benutzer anlegen/bearbeiten/löschen\n"
            "• Trainer & Spieler-Stammdaten verwalten\n"
            "• Saisons, Plätze, Pläne anlegen, Solver starten\n"
            "• Als einzige Rolle Profile *aller* Personen ändern\n\n"
            "**🎾 Trainer (Coach)**\n"
            "• Eigenes Profil + Verfügbarkeit ändern\n"
            "• Spieler-Liste sehen, **LK aller Spieler** anpassen\n"
            "• Eigene Sessions im Plan sehen\n\n"
            "**🏃 Spieler (Player)**\n"
            "• Eigenes Profil + Verfügbarkeit ändern\n"
            "• Wunschtrainer + Wunsch-Mitspieler eintragen\n"
            "• Eigene Sessions im Plan sehen\n"
            "• Kann LK *nicht* selbst setzen, nicht „Trainer" werden"
        ),
    ),
    Topic(
        title="Trainer anlegen",
        keywords={"trainer anlegen", "neuer trainer", "coach anlegen", "trainer erstellen", "trainer hinzufügen", "trainer hinzufuegen"},
        answer=(
            "**Neuen Trainer anlegen** (nur Admin):\n"
            "1. Reiter *Benutzer → Neuen Benutzer anlegen*.\n"
            "2. E-Mail + Initial-Passwort eingeben.\n"
            "3. Rolle = **Trainer** wählen → der Trainer-Datensatz wird "
            "automatisch verlinkt.\n"
            "4. Der Trainer loggt sich ein und füllt unter "
            "*Trainer → Mein Profil* aus: Verfügbarkeit, "
            "max. Stunden/Tag und /Woche, akzeptierte LK-Stufen, "
            "akzeptierter Altersbereich, Mindest-Block-Länge.\n\n"
            "Ohne Profil-Daten plant der Solver **keine Sessions** für diesen "
            "Trainer."
        ),
    ),
    Topic(
        title="Spieler anlegen",
        keywords={"spieler anlegen", "neuer spieler", "schüler anlegen", "schueler anlegen", "spieler erstellen", "spieler hinzufügen", "spieler hinzufuegen"},
        answer=(
            "**Neuen Spieler anlegen** (nur Admin):\n"
            "1. Reiter *Benutzer → Neuen Benutzer anlegen*.\n"
            "2. E-Mail + Initial-Passwort eingeben.\n"
            "3. Rolle = **Spieler** wählen.\n"
            "4. Der Spieler loggt sich ein und füllt unter *Spieler → Mein "
            "Profil* aus: Verfügbarkeit, Stunden/Woche (min/max/wunsch), "
            "Wunschtrainer, Wunsch-Mitspieler, Alter.\n"
            "5. Ein Trainer setzt anschließend in der Spieler-Liste die LK."
        ),
    ),
    Topic(
        title="Benutzer löschen",
        keywords={"benutzer löschen", "benutzer loeschen", "user löschen", "user loeschen", "account löschen", "account loeschen", "deaktivieren"},
        answer=(
            "**Benutzer entfernen** (nur Admin):\n"
            "1. Reiter *Benutzer*\n"
            "2. Zeile öffnen → **Löschen** (oder Häkchen *aktiv* entfernen, "
            "wenn der Account erhalten bleiben soll).\n\n"
            "Bei einer Löschung bleiben historische Plan-Daten anonymisiert "
            "erhalten (Foreign Keys werden auf NULL gesetzt). Wenn der User "
            "selbst löschen will: `DELETE /api/me` (DSGVO Art. 17)."
        ),
    ),
    Topic(
        title="Passwort ändern",
        keywords={"passwort", "password", "kennwort", "vergessen", "reset"},
        answer=(
            "**Passwort-Änderung**:\n"
            "• Aktuell setzt ein **Admin** das Passwort über "
            "*Benutzer → Bearbeiten → neues Passwort*.\n"
            "• Eine Self-Service-Funktion (Spieler/Trainer ändern selbst) "
            "ist noch nicht eingebaut.\n"
            "• Ein **vergessenes Passwort** muss aktuell vom Admin "
            "zurückgesetzt werden.\n\n"
            "Tipp: bei der ersten Anmeldung ein langes, einmaliges "
            "Initial-Passwort vergeben."
        ),
    ),
    Topic(
        title="Login / Anmelden",
        keywords={"login", "anmelden", "einloggen", "log in", "sign in"},
        answer=(
            "**Anmelden**: Reiter *Anmelden* (oben rechts) oder direkt "
            "`/login`. E-Mail + Passwort eingeben. Nach erfolgreichem Login "
            "lädt die Navigation automatisch die deiner Rolle entsprechenden "
            "Reiter (Verfügbarkeiten und Benutzer-Verwaltung sind Admin-only)."
        ),
    ),
    Topic(
        title="Logout / Abmelden",
        keywords={"logout", "abmelden", "ausloggen", "sign out"},
        answer=(
            "**Abmelden**: oben rechts in der Navigation auf den eigenen "
            "Namen → *Abmelden*. Das löscht JWT und Rollen-Cache; danach "
            "wirst du auf den Login zurückgeleitet."
        ),
    ),

    # ---------- Pages / Navigation ----------
    Topic(
        title="Reiter Pläne",
        keywords={"reiter pläne", "tab pläne", "pläne seite", "plansseite", "plans page", "/plaene"},
        answer=(
            "Reiter **Pläne** hat drei Unterreiter:\n"
            "• **Liste** — alle Pläne, sortiert nach Score; aktiver Plan ist "
            "markiert.\n"
            "• **Vergleichen** — zwei Pläne nebeneinander.\n"
            "• **Saisonwechsel** — Wizard zum Erzeugen neuer Plan-Varianten."
        ),
    ),
    Topic(
        title="Reiter Trainer",
        keywords={"reiter trainer", "trainer seite", "trainer-seite", "/trainer", "coach page"},
        answer=(
            "Reiter **Trainer** hat drei Unterreiter:\n"
            "• **Liste** — Tabelle aller Trainer mit max. Gruppengröße, "
            "akzeptierter LK-Bereich, akzeptierter Altersbereich, max. "
            "Stunden/Tag und /Woche, Verfügbarkeits-Stunden.\n"
            "• **Mein Profil** — der eingeloggte Trainer bearbeitet eigene "
            "Daten + Verfügbarkeit.\n"
            "• **Bulk-Editor** (Admin) — mehrere Trainer auf einmal pflegen."
        ),
    ),
    Topic(
        title="Reiter Spieler",
        keywords={"reiter spieler", "spieler seite", "/spieler", "player page", "schüler seite", "schueler seite"},
        answer=(
            "Reiter **Spieler** hat zwei Unterreiter:\n"
            "• **Liste** — Tabelle aller Spieler. Trainer können hier die "
            "**LK** inline anpassen.\n"
            "• **Mein Profil** — der eingeloggte Spieler bearbeitet eigene "
            "Daten + Verfügbarkeit + Wunschtrainer/-Mitspieler."
        ),
    ),
    Topic(
        title="Reiter Verfügbarkeiten",
        keywords={"reiter verfügbarkeiten", "reiter verfuegbarkeiten", "verfügbarkeiten seite", "verfuegbarkeiten seite", "/verfuegbarkeiten", "availability page"},
        answer=(
            "Reiter **Verfügbarkeiten** (nur Admin) zeigt eine kombinierte "
            "Übersicht aller Trainer, Spieler und Plätze über die ganze "
            "Woche. Hier kannst du als Admin **fremde Verfügbarkeiten** "
            "korrigieren. Trainer/Spieler nutzen lieber ihr eigenes Profil."
        ),
    ),
    Topic(
        title="Reiter Benutzer",
        keywords={"reiter benutzer", "benutzer-verwaltung", "benutzerverwaltung", "/admin/users", "users admin", "user management"},
        answer=(
            "Reiter **Benutzer** (nur Admin):\n"
            "• Liste aller Konten mit E-Mail, Rolle, aktiv-Status\n"
            "• Anlegen neuer User mit Initial-Passwort\n"
            "• Rolle ändern (Admin/Trainer/Spieler) — ein verlinkter "
            "Trainer-/Spieler-Datensatz wird automatisch erzeugt\n"
            "• Passwort zurücksetzen, Account deaktivieren/löschen"
        ),
    ),

    # ---------- Profile ----------
    Topic(
        title="Mein Profil",
        keywords={"mein profil", "eigenes profil", "profil bearbeiten", "profil ändern", "profil aendern", "my profile"},
        answer=(
            "**Mein Profil** findet sich:\n"
            "• Trainer: Reiter *Trainer → Mein Profil*\n"
            "• Spieler: Reiter *Spieler → Mein Profil*\n\n"
            "Hier änderst du Verfügbarkeit, Wunschdaten, Stunden-Limits. "
            "Andere Profile dürfen Trainer/Spieler **nicht** ändern — nur "
            "der Admin kann das. Trainer dürfen bei allen Spielern "
            "**die LK** in der Spielerliste setzen."
        ),
    ),
    Topic(
        title="Verfügbarkeit ändern",
        keywords={"verfügbar", "verfuegbar", "availability", "zeit eintragen", "zeitfenster", "zeiten", "kalender"},
        answer=(
            "**Verfügbarkeit eintragen**:\n"
            "• Spieler: *Spieler → Mein Profil* → Wochenraster.\n"
            "• Trainer: *Trainer → Mein Profil* → Wochenraster.\n"
            "• Plätze (Admin): *Verfügbarkeiten*.\n\n"
            "Das Raster zeigt Mo–So × 06:00–21:00 in 30-Min-Schritten. "
            "**Klicke und ziehe**, um ein Zeitfenster zu markieren oder zu "
            "löschen. Grün = verfügbar, leer = nicht verfügbar."
        ),
    ),
    Topic(
        title="Wunschtrainer",
        keywords={"wunschtrainer", "lieblingstrainer", "preferred coach", "präferenz trainer", "praeferenz trainer"},
        answer=(
            "Im Spieler-Profil können bis zu 3 **Wunschtrainer** angegeben "
            "werden. Der Solver versucht im Score, diese Wünsche zu "
            "erfüllen — es ist aber kein Muss. Wunschtrainer haben Vorrang "
            "vor anderen Trainer-Soft-Constraints."
        ),
    ),
    Topic(
        title="Wunsch-Mitspieler",
        keywords={"mitspieler", "lieblingspartner", "wunsch mitspieler", "wunschpartner", "preferred partner", "preferred player"},
        answer=(
            "Spieler können **Wunsch-Mitspieler** angeben (z.B. „spiele am "
            "liebsten mit Anna und Ben"). Der Solver erhält Pluspunkte, "
            "wenn er diese Spieler in dieselbe Session steckt — Voraussetzung: "
            "ähnliche LK und überlappende Verfügbarkeit."
        ),
    ),
    Topic(
        title="Stunden pro Woche",
        keywords={"stunden pro woche", "min slots", "max slots", "wunschstunden", "wunsch stunden", "trainingsstunden"},
        answer=(
            "Spieler tragen drei Werte ein:\n"
            "• **Min. Stunden/Woche** — harter Constraint, wird nie "
            "unterschritten.\n"
            "• **Max. Stunden/Woche** — harter Constraint, wird nie "
            "überschritten.\n"
            "• **Wunsch-Stunden/Woche** — Soft-Constraint, fließt in den "
            "Score ein.\n\n"
            "Trainer haben zusätzlich **max. Stunden/Tag** und "
            "**max. Stunden/Woche**."
        ),
    ),
    Topic(
        title="Mindest-Block-Länge",
        keywords={"mindestblock", "min block", "blocklänge", "blocklaenge", "zusammenhängend", "zusammenhaengend"},
        answer=(
            "Die **Mindest-Block-Länge** verhindert, dass eine Session in "
            "winzige Stücke zerfällt. Beispiel: Block = 2 Slots = 60 Minuten. "
            "Der Solver darf dann keine 30-Minuten-Einzelstunde planen.\n\n"
            "Sinnvolle Werte: 1 (Einzelstunden zulassen) bis 3 (mind. 90 "
            "Min Block)."
        ),
    ),
    Topic(
        title="Akzeptierte LK / Alter (Trainer)",
        keywords={"accepts_lk", "accepts_age", "akzeptierte lk", "akzeptiertes alter", "altersgruppe trainer", "lk-bereich"},
        answer=(
            "Im Trainer-Profil:\n"
            "• `accepts_lk_min` / `accepts_lk_max` — der Trainer trainiert "
            "nur Spieler in diesem LK-Bereich.\n"
            "• `accepts_age_min` / `accepts_age_max` — analog für das Alter.\n\n"
            "Lässt du ein Feld **leer**, gilt **kein Limit** in dieser "
            "Richtung (z.B. nur `accepts_lk_max=12` → der Trainer nimmt "
            "alles ab Profi bis LK 12, aber nichts Schwächeres)."
        ),
    ),

    # ---------- Court / Plätze ----------
    Topic(
        title="Plätze / Courts",
        keywords={"platz", "plätze", "plaetze", "court", "courts", "halle", "outdoor", "tennisplatz"},
        answer=(
            "**Plätze** verwalten (Admin): Reiter *Verfügbarkeiten* zeigt "
            "Platz-Verfügbarkeiten. Anlage neuer Plätze aktuell nur per "
            "API (`POST /api/courts`) — dort: Name, Indoor (true/false), "
            "Verfügbarkeit. Der Solver weist jeder Session einen Platz zu "
            "und minimiert Wechsel zwischen Plätzen pro Spieler."
        ),
    ),

    # ---------- Chat ----------
    Topic(
        title="Chat-Bot Funktionsweise",
        keywords={"chat bot", "chatbot", "chat-dock", "chatdock", "chat assistent", "chat funktion"},
        answer=(
            "Unten rechts findest du das **Chat-Dock**. Es ist ein "
            "regelbasierter Bot (kein LLM), der über Stichworte arbeitet. "
            "Du kannst nach Daten fragen („Welche Trainer haben wir?"), nach "
            "Erklärungen („Was ist der Solver?") oder nach Workflow-Hilfe "
            "(„Wie lege ich einen Spieler an?"). Tippe **hilfe** für die "
            "volle Themenliste."
        ),
    ),

    # ---------- DSGVO / Privacy ----------
    Topic(
        title="DSGVO / Datenexport",
        keywords={"dsgvo", "gdpr", "datenschutz", "datenexport", "daten exportieren", "export meiner daten"},
        answer=(
            "**DSGVO-Funktionen**:\n"
            "• **Art. 15 (Auskunft)**: `GET /api/me/export` liefert alle "
            "personenbezogenen Daten als JSON.\n"
            "• **Art. 17 (Löschung)**: `DELETE /api/me` entfernt deinen "
            "Account; historische Plan-Daten werden anonymisiert.\n"
            "• **Art. 20 (Datenübertragbarkeit)**: das JSON aus Art. 15 ist "
            "maschinenlesbar.\n\n"
            "Datenschutz-Verantwortliche*r für die Installation ist der "
            "Vereins-Admin."
        ),
    ),

    # ---------- Operations ----------
    Topic(
        title="Backup",
        keywords={"backup", "sicherung", "datensicherung", "restore", "wiederherstellen"},
        answer=(
            "**Backup** (siehe `docs/SETUP.md` Abschnitt 10):\n"
            "PowerShell im Repo-Ordner:\n"
            "```\n"
            "docker compose --env-file .env -f deploy/docker-compose.yml `\n"
            "  exec db pg_dump -U coach coach_assistant > backup-2026-05-20.sql\n"
            "```\n"
            "Die SQL-Datei sicherst du auf einem externen Medium (USB, "
            "Cloud-Speicher). **Wiederherstellen**:\n"
            "```\n"
            "Get-Content backup-2026-05-20.sql | docker compose --env-file `\n"
            "  .env -f deploy/docker-compose.yml exec -T db psql -U coach `\n"
            "  -d coach_assistant\n"
            "```\n"
            "Empfehlung: tägliches automatisches Backup per Aufgabenplanung."
        ),
    ),
    Topic(
        title="Update / git pull",
        keywords={"update", "aktualisier", "neue version", "git pull", "upgraden", "upgrade"},
        answer=(
            "**Update** auf neue Version:\n"
            "```\n"
            "cd C:\\Git_Repos\\coach_assistant\n"
            "git pull\n"
            "docker compose --env-file .env -f deploy/docker-compose.yml `\n"
            "  up -d --build api web worker\n"
            "```\n"
            "Datenbank-Migrationen laufen automatisch beim API-Start "
            "(Alembic). Dauer: 1–3 Minuten."
        ),
    ),
    Topic(
        title="Container neustarten",
        keywords={"neustart", "restart", "container starten", "container stoppen", "down", "up -d"},
        answer=(
            "**Alles stoppen**: `docker compose --env-file .env -f "
            "deploy/docker-compose.yml down`\n"
            "**Alles starten**: `docker compose --env-file .env -f "
            "deploy/docker-compose.yml up -d`\n"
            "**Einzelnen Service neustarten** (z.B. nur API): "
            "`... restart api`\n\n"
            "Status: `... ps`. Logs: `... logs -f api`."
        ),
    ),
    Topic(
        title="Logs ansehen",
        keywords={"logs", "log", "fehlermeldung suchen", "logfile"},
        answer=(
            "**Logs eines Services** (z.B. API):\n"
            "```\n"
            "docker compose --env-file .env -f deploy/docker-compose.yml `\n"
            "  logs -f api\n"
            "```\n"
            "Andere Services: `web`, `worker`, `db`, `caddy`, `cloudflared`. "
            "Mit `--tail 100` siehst du nur die letzten 100 Zeilen."
        ),
    ),
    Topic(
        title="Cloudflare Tunnel",
        keywords={"cloudflare", "tunnel", "öffentlich erreichbar", "oeffentlich erreichbar", "von außen", "von aussen", "domain", "https"},
        answer=(
            "Die App wird über einen **Cloudflare Tunnel** öffentlich "
            "erreichbar (Details: `docs/SETUP.md` Abschnitt 7). Zwei "
            "Varianten:\n"
            "• **A) eigene Domain** — `https://coach.dein-verein.de`, "
            "~10 €/Jahr.\n"
            "• **B) Quick Tunnel** — `https://coach-xyz.trycloudflare.com`, "
            "kostenlos.\n\n"
            "HTTPS-Zertifikat besorgt Cloudflare automatisch. Kein offener "
            "Port am Router nötig."
        ),
    ),
    Topic(
        title="Architektur / Stack",
        keywords={"architektur", "stack", "tech", "technologie", "framework", "wie ist das gebaut"},
        answer=(
            "**Tech-Stack**:\n"
            "• Backend: Python 3.12, FastAPI, SQLAlchemy 2 (async), "
            "PostgreSQL 16, Alembic, fastapi-users (Argon2id+JWT).\n"
            "• Solver: Google OR-Tools CP-SAT (im Worker-Container).\n"
            "• Frontend: React 18, TypeScript, Vite, TanStack Query, "
            "react-router-dom.\n"
            "• Deployment: Docker Compose (db, redis, api, worker, web, "
            "caddy, cloudflared).\n"
            "• Architektur: hexagonal (domain / application / infrastructure "
            "/ interfaces). Lizenz: AGPL-3.0."
        ),
    ),
    Topic(
        title="API-Doku",
        keywords={"api", "openapi", "swagger", "/docs", "rest api", "endpoint"},
        answer=(
            "Die REST-API ist unter **`/api/docs`** als Swagger-UI dokumentiert "
            "(z.B. `https://coach.dein-verein.de/api/docs`). Dort findest du "
            "alle Endpoints, kannst sie ausprobieren und das OpenAPI-JSON "
            "unter `/api/openapi.json` herunterladen."
        ),
    ),

    # ---------- Status / health ----------
    Topic(
        title="Status / Health",
        keywords={"status", "health", "läuft alles", "laeuft alles", "online", "erreichbar"},
        answer=(
            "Wenn du diesen Bot fragen kannst, läuft die **API** und du bist "
            "**eingeloggt**. Service-Status auf dem Server: "
            "`docker compose --env-file .env -f deploy/docker-compose.yml ps`. "
            "Erwartet: alle Services `running` oder `healthy`."
        ),
    ),
    Topic(
        title="Fehler beheben",
        keywords={"fehler", "error", "geht nicht", "funktioniert nicht", "kaputt", "bug", "problem"},
        answer=(
            "Allgemeine Vorgehensweise bei Problemen:\n"
            "1. **Logs ansehen** — `... logs -f api` oder `... logs -f web`.\n"
            "2. **Container-Status** — `... ps` (alle `running`?).\n"
            "3. **Browser-Cache leeren** — Strg+F5.\n"
            "4. **Container neustarten** — `... restart api`.\n"
            "5. **Frage konkretisieren**: Welche Seite? Welcher Knopf? "
            "Welche Fehlermeldung?\n\n"
            "Mehr unter `docs/SETUP.md` Abschnitt 11."
        ),
    ),

    # ---------- Greetings handled separately, but a topic for "danke" ----------
    Topic(
        title="Dank",
        keywords={"danke", "thanks", "thank you", "merci", "vielen dank"},
        answer="Gerne! Wenn du noch Fragen hast — tippe **hilfe** für die Themenliste.",
    ),
]


# ---------- Live-data intents ----------


async def _list_coaches(_text: str, db: AsyncSession) -> str:
    rows = (await db.execute(select(CoachORM).order_by(CoachORM.name))).scalars().all()
    if not rows:
        return "Es sind aktuell keine Trainer angelegt."
    lines = [f"**{len(rows)} Trainer**:"]
    for c in rows:
        lines.append(f"• {c.name} (max. Gruppengröße {c.max_group_size})")
    return "\n".join(lines)


async def _list_players(_text: str, db: AsyncSession) -> str:
    rows = (await db.execute(select(PlayerORM).order_by(PlayerORM.name))).scalars().all()
    if not rows:
        return "Es sind aktuell keine Spieler angelegt."
    lines = [f"**{len(rows)} Spieler**:"]
    for p in rows:
        prefs = p.preferences or {}
        lk = prefs.get("level_lk")
        age = prefs.get("age")
        extras = []
        if lk is not None:
            extras.append(f"LK {lk}")
        if age is not None:
            extras.append(f"{age} J.")
        extras.append(f"{p.min_slots_per_week}–{p.max_slots_per_week} Std/W")
        lines.append(f"• {p.name} ({', '.join(extras)})")
    return "\n".join(lines)


async def _list_courts(_text: str, db: AsyncSession) -> str:
    rows = (await db.execute(select(CourtORM).order_by(CourtORM.name))).scalars().all()
    if not rows:
        return "Es sind aktuell keine Plätze angelegt."
    lines = [f"**{len(rows)} Plätze**:"]
    for c in rows:
        kind = "Halle" if c.indoor else "Outdoor"
        lines.append(f"• {c.name} ({kind})")
    return "\n".join(lines)


async def _list_seasons(_text: str, db: AsyncSession) -> str:
    rows = (await db.execute(select(SeasonORM).order_by(SeasonORM.valid_from.desc()))).scalars().all()
    if not rows:
        return "Es sind aktuell keine Saisons angelegt."
    lines = [f"**{len(rows)} Saisons**:"]
    for s in rows:
        lines.append(f"• {s.name} ({s.valid_from} – {s.valid_to})")
    return "\n".join(lines)


async def _count_users(_text: str, db: AsyncSession) -> str:
    rows = (await db.execute(select(UserORM))).scalars().all()
    by_role: dict[str, int] = {}
    for u in rows:
        by_role[u.role] = by_role.get(u.role, 0) + 1
    if not by_role:
        return "Keine Benutzer im System."
    lines = [f"**{len(rows)} Benutzer** insgesamt:"]
    for role, count in sorted(by_role.items()):
        lines.append(f"• {role}: {count}")
    return "\n".join(lines)


async def _list_plans(_text: str, db: AsyncSession) -> str:
    rows = (await db.execute(
        select(PlanORM, SeasonORM)
        .join(SeasonORM, PlanORM.season_id == SeasonORM.id)
        .order_by(PlanORM.created_at.desc())
        .limit(10)
    )).all()
    if not rows:
        return "Es wurden noch keine Pläne generiert."
    lines = [f"**Letzte Pläne** (max. 10):"]
    for plan, season in rows:
        lines.append(f"• {season.name} — Score {plan.score:.1f} ({plan.created_at:%Y-%m-%d})")
    return "\n".join(lines)


# Order matters: more specific intents first.
INTENTS: list[tuple[list[set[str]], Callable[[str, AsyncSession], Awaitable[str]]]] = [
    ([{"wie viele", "anzahl", "count"}, {"benutzer", "user", "konten", "accounts"}], _count_users),
    ([{"trainer", "coach", "coaches"}, {"welche", "liste", "list", "wer", "alle", "zeig", "show"}], _list_coaches),
    ([{"spieler", "player", "schüler", "schueler"}, {"welche", "liste", "list", "wer", "alle", "zeig", "show"}], _list_players),
    ([{"platz", "plätze", "plaetze", "court", "courts"}, {"welche", "liste", "list", "alle", "zeig", "show"}], _list_courts),
    ([{"saison", "saisons", "season", "seasons"}, {"welche", "liste", "list", "alle", "zeig", "show"}], _list_seasons),
    ([{"plan", "pläne", "plaene", "plans"}, {"liste", "list", "letzt", "neust", "recent", "alle", "zeig", "show"}], _list_plans),
]


# ---------- Matcher / fallback ----------


def _has_any(text: str, words: set[str]) -> bool:
    return any(w in text for w in words)


def _has_all_groups(text: str, groups: list[set[str]]) -> bool:
    return all(_has_any(text, group) for group in groups)


def _topic_score(text: str, topic: Topic) -> int:
    """Number of keyword hits — used to suggest related topics on fallback."""
    return sum(1 for kw in topic.keywords if kw in text)


def _suggest_topics(text: str, limit: int = 4) -> list[str]:
    scored = [(t, _topic_score(text, t)) for t in KNOWLEDGE]
    scored = [(t, s) for t, s in scored if s > 0]
    scored.sort(key=lambda p: p[1], reverse=True)
    return [t.title for t, _ in scored[:limit]]


HELP_FALLBACK_BASE = (
    "Das habe ich nicht ganz verstanden. Tippe **hilfe** für eine "
    "Übersicht aller Themen, die ich beantworten kann.\n\n"
    "Beispiele:\n"
    "• „Welche Trainer haben wir?"\n"
    "• „Wie funktioniert der Solver?"\n"
    "• „Was bedeutet LK?"\n"
    "• „Wie lege ich einen Spieler an?""
)


def _fallback(text: str) -> str:
    suggestions = _suggest_topics(text)
    if not suggestions:
        return HELP_FALLBACK_BASE
    bullet = "\n".join(f"• {title}" for title in suggestions)
    return (
        "Das habe ich nicht eindeutig erkannt. Meintest du eines dieser "
        f"Themen?\n\n{bullet}\n\n"
        "Tippe das passende Stichwort oder **hilfe** für die volle Liste."
    )


GREETING_RE = re.compile(
    r"^\s*(hi|hallo|hey|moin|servus|guten\s+(tag|morgen|abend))\b",
    re.IGNORECASE,
)


async def answer(message: str, db: AsyncSession) -> str:
    """Return a deterministic answer for the given user message."""
    text = message.strip()
    if not text:
        return HELP_FALLBACK_BASE
    lower = text.lower()

    # 1. Live-data intents
    for groups, handler in INTENTS:
        if _has_all_groups(lower, groups):
            try:
                return await handler(lower, db)
            except Exception as exc:  # noqa: BLE001
                return f"Datenbank-Fehler beim Beantworten: {exc}"

    # 2. Static knowledge — first match wins
    for topic in KNOWLEDGE:
        if topic.requires and not _has_all_groups(lower, topic.requires):
            continue
        if _has_any(lower, topic.keywords):
            return topic.answer

    # 3. Greetings
    if GREETING_RE.match(lower):
        return (
            "Hallo! 👋 Ich bin der Coach-Assistent. Frage mich z.B. "
            "„Welche Trainer haben wir?" oder tippe **hilfe**."
        )

    # 4. Suggestion-based fallback
    return _fallback(lower)
