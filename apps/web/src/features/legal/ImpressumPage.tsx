import { LegalGuard } from "./LegalGuard";

export function ImpressumPage() {
  return (
    <LegalGuard title="Impressum">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Impressum</h2>
        <p><strong>Angaben gemäß § 5 TMG / DDG</strong></p>
        <p>
          Tennisclub Weil im Schönbuch e.V.<br />
          Clubhaus: Stäudach<br />
          Halle: Tübinger Str. 82, 71093 Weil im Schönbuch
        </p>

        <p>
          <strong>Vereinsregister:</strong> Amtsgericht Stuttgart<br />
          <strong>Vereinsregisternummer:</strong> VR 240732
        </p>

        <p>
          <strong>Mitglied im:</strong> Württembergischer Tennisbund (WTB), www.wtb-tennis.de<br />
          <strong>WTB Vereins-Nr.:</strong> 20376
        </p>

        <p>
          <strong>Vertreten durch den Vorstand:</strong><br />
          Eugen Lengerer (1. Vorstandsvorsitzender)
        </p>

        <p>
          <strong>Kontakt:</strong><br />
          Telefon: 07157 / 62370<br />
          Telefax: 07157 / 668891<br />
          E-Mail: vorstand@tennisclub-weil.de
        </p>

        <p>
          <strong>Verantwortlich i. S. d. § 18 Abs. 2 MStV:</strong><br />
          Eugen Lengerer, Anschrift wie oben
        </p>

        <h3>Verbraucherstreitbeilegung (§ 36 VSBG)</h3>
        <p style={{ fontSize: "var(--text-sm)" }}>
          Wir sind zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
          nicht verpflichtet und nicht bereit.
        </p>

        <h3>Haftungshinweise</h3>
        <p style={{ fontSize: "var(--text-sm)" }}>
          Trotz sorgfältiger inhaltlicher Kontrolle übernehmen wir keine Haftung für die Inhalte externer
          Links. Für den Inhalt der verlinkten Seiten sind ausschließlich deren Betreiber verantwortlich.
        </p>
        <p style={{ fontSize: "var(--text-sm)" }}>
          Am 12. Mai 1998 hat das Landgericht Hamburg entschieden, dass man durch die Ausbringung eines
          Links die Inhalte der gelinkten Seite ggf. mitzuverantworten hat. Dies kann – so das LG – nur
          dadurch verhindert werden, dass man sich ausdrücklich von diesen Inhalten distanziert. Deshalb
          gilt für alle Links, die sich auf diesen Webseiten befinden, folgendes: Für den Inhalt der
          einzelnen Internet-Seiten ist ausschließlich der betreffende Autor selbst verantwortlich! Wir
          möchten ausdrücklich betonen, dass wir keinerlei Einfluss auf die Gestaltung und die Inhalte der
          von uns gelinkten Seiten haben. Deshalb distanzieren wir uns hiermit ausdrücklich von deren
          Inhalten. Diese Erklärung gilt auch für alle Inhalte der Seiten, zu denen Banner führen.
        </p>
      </div>
    </LegalGuard>
  );
}
