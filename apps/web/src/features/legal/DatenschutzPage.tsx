import { LegalGuard } from "./LegalGuard";

export function DatenschutzPage() {
  return (
    <LegalGuard title="Datenschutzerklärung">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Datenschutzerklärung</h2>

        <h3>1. Verantwortlicher</h3>
        <p>
          Tennisclub Weil im Schönbuch e.V.<br />
          1. Vorsitzender Eugen Lengerer<br />
          Tübinger Str. 82<br />
          71093 Weil im Schönbuch<br />
          E-Mail: vorstand@tennisclub-weil.de
        </p>

        <h3>2. Welche Daten werden verarbeitet?</h3>
        <p>
          Name, Verfügbarkeiten, Alter/Geburtsdatum, Spielstärke (LK), Trainingskategorie,
          Kontaktdaten (E-Mail bei Benutzerkonten), sowie freiwillige Angaben im Bemerkungsfeld
          (z. B. Trainingswünsche — hier <strong>keine</strong> Gesundheitsdaten eintragen, sofern
          dafür keine gesonderte Einwilligung vorliegt, siehe Punkt 5).
        </p>

        <h3>3. Zweck der Verarbeitung</h3>
        <p>Organisation und automatisierte Erstellung von Trainingsplänen für den Vereins-Trainingsbetrieb.</p>

        <h3>4. Rechtsgrundlage</h3>
        <p>
          Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung im Rahmen der Vereinsmitgliedschaft) sowie
          Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer geordneten Organisation des
          Trainingsbetriebs).
        </p>

        <h3>5. Minderjährige</h3>
        <p>
          Es werden auch Daten von Kindern und Jugendlichen (Kategorien Ballschule, U8–U18) verarbeitet.
          In der Regel tragen Eltern die Daten jüngerer Kinder ein, ältere Jugendliche pflegen ihr Profil
          zunehmend selbst. Beim ersten Login bestätigt jeder Nutzer bzw. jede Nutzerin (bei jüngeren
          Kindern: die Eltern) aktiv diese Datenschutzerklärung, bevor die App genutzt werden kann.
        </p>

        <h3>6. Empfänger / Auftragsverarbeiter</h3>
        <p>
          <strong>Cloudflare</strong> (Cloudflare Tunnel, Absicherung/Erreichbarkeit der Webseite) —
          Auftragsverarbeitung gemäß Art. 28 DSGVO, siehe <code>docs/PRIVACY.md</code>.<br />
          <strong>Microsoft OneDrive</strong> — tägliche, automatisierte Datenbank-Sicherungen (Backups)
          werden dorthin synchronisiert, damit bei einem Defekt des Servers keine Daten verloren gehen.
          Die Backups sind vor dem Hochladen mit AES-256 verschlüsselt — Microsoft (bzw. jeder mit
          Zugriff auf das OneDrive-Konto) sieht nur eine unlesbare, verschlüsselte Datei, keine
          Klartextdaten. Dies erfolgt aktuell über ein privates Microsoft-Konto des technisch
          Verantwortlichen (nicht über ein offizielles Vereinskonto).<br />
          Keine Weitergabe an sonstige Dritte, kein Einsatz externer KI-Dienste (der Chat-Assistent ist
          regelbasiert und läuft ausschließlich lokal auf dem eigenen Server, siehe Punkt 10).
        </p>

        <h3>7. Wer innerhalb des Vereins sieht welche Daten?</h3>
        <p>
          Zugriff ist rollenbasiert eingeschränkt: <strong>Admins/Planer</strong> sehen alle Daten aller
          Spieler und Trainer. <strong>Trainer</strong> sehen die Daten der Spieler (zur Trainingsplanung),
          aber keine Verwaltungsfunktionen. <strong>Spieler</strong> sehen ausschließlich ihre eigenen
          Daten sowie Namen der Trainer. Alle Änderungen werden mit Zeitstempel und ausführender Person
          protokolliert (Audit-Log) — dient der Nachvollziehbarkeit, nicht der Verhaltenskontrolle.
        </p>

        <h3>8. Cookies und lokale Speicherung</h3>
        <p>
          Es werden keine Tracking- oder Marketing-Cookies eingesetzt. Für den Login wird ein technisch
          notwendiges Sitzungs-Token im Browser gespeichert (<code>sessionStorage</code>), das beim
          Schließen des Tabs automatisch gelöscht wird.
        </p>

        <h3>9. Chat-Assistent</h3>
        <p>
          Der in der App integrierte Chat ist <strong>kein</strong> KI-/Sprachmodell, sondern ein
          regelbasiertes System, das ausschließlich lokal auf dem eigenen Server läuft. Eingaben werden
          nicht an externe Dienste (z. B. OpenAI, Google) übermittelt.
        </p>

        <h3>10. Speicherdauer</h3>
        <p>
          Die Trainingsplanungs-Daten (Verfügbarkeiten, Geburtsdatum, LK, Kategorien, Notizen) werden für
          die Dauer der aktiven Vereinsmitgliedschaft bzw. Nutzung der App gespeichert. Nach Austritt aus
          dem Verein werden diese Daten innerhalb von 6 Monaten gelöscht, sofern keine gesetzlichen
          Aufbewahrungspflichten entgegenstehen.
        </p>

        <h3>11. Betroffenenrechte</h3>
        <p>
          Unter den oben genannten Kontaktdaten können Sie jederzeit folgende Rechte ausüben:
        </p>
        <ul style={{ fontSize: "var(--text-sm)" }}>
          <li>Auskunft über die bei uns gespeicherten Daten und deren Verarbeitung (Art. 15 DSGVO),</li>
          <li>Berichtigung unrichtiger personenbezogener Daten (Art. 16 DSGVO),</li>
          <li>Löschung der bei uns gespeicherten Daten (Art. 17 DSGVO),</li>
          <li>Einschränkung der Datenverarbeitung, sofern wir Daten aufgrund gesetzlicher Pflichten noch nicht löschen dürfen (Art. 18 DSGVO),</li>
          <li>Widerspruch gegen die Verarbeitung der Daten bei uns (Art. 21 DSGVO) und</li>
          <li>Datenübertragbarkeit, sofern eine Einwilligung erteilt wurde oder ein Vertrag besteht (Art. 20 DSGVO).</li>
        </ul>
        <p>
          Datenexport und Konto-Löschung stehen jedem Nutzer zusätzlich direkt und jederzeit selbst unter
          „Mein Konto" zur Verfügung, ohne uns extra kontaktieren zu müssen.
        </p>
        <p>
          Sie können sich jederzeit mit einer Beschwerde an die zuständige Aufsichtsbehörde wenden. Eine
          Liste der Aufsichtsbehörden mit Anschrift finden Sie unter{" "}
          <a href="https://www.bfdi.bund.de/DE/Infothek/Anschriften_Links/anschriften_links-node.html" target="_blank" rel="noreferrer">
            www.bfdi.bund.de
          </a>.
        </p>

        <h3>12. Hosting</h3>
        <p>
          Die App wird selbst betrieben (Self-Hosting) in Deutschland, erreichbar über einen Cloudflare
          Tunnel (siehe Punkt 6), auf technischer Infrastruktur des technisch Verantwortlichen für den
          Verein. Es wird keine externe Hosting-Firma eingesetzt.
        </p>
      </div>
    </LegalGuard>
  );
}
