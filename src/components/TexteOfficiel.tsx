// Un texte officiel (dispositif d'un amendement, exposé des motifs, article d'un texte), le
// même partout. Dans son propre fichier pour rester léger : le tiroir d'un article le monte
// sans charger l'hémicycle ni les tableaux de vote.

/** Découpe un texte officiel en suites de lignes de texte et de lignes de tableau. L'import
 *  écrit les tableaux (états du budget) en lignes `| a | b |`, sans toujours les `|` des
 *  bords (« Recettes totales | 375 674 »). Une ligne de texte n'en contient pas. */
function blocsDuTexte(texte: string): { tableau: boolean; lignes: string[] }[] {
  const blocs: { tableau: boolean; lignes: string[] }[] = [];
  for (const ligne of texte.split('\n')) {
    const tableau = ligne.includes('|');
    const dernier = blocs.at(-1);
    if (dernier?.tableau === tableau) dernier.lignes.push(ligne);
    else blocs.push({ tableau, lignes: [ligne] });
  }
  return blocs;
}

/** Ses retours à la ligne comptent (alinéas d'un dispositif), et ses tableaux défilent de
 *  côté plutôt que d'élargir la page sur téléphone. `cadre`, dans les tiroirs : un cadre qui
 *  défile, car un article du budget dépasse 200 000 caractères et un amendement 60 000. */
export default function TexteOfficiel({ children, cadre = false }: { children: string; cadre?: boolean }) {
  return (
    <div style={cadre ? { maxHeight: '24rem', overflowY: 'auto' } : undefined}>
      {blocsDuTexte(children).map((b, i) => b.tableau ? (
        <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', lineHeight: 1.45 }}>
            <tbody>
              {b.lignes
                .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
                .filter((cellules) => cellules.some(Boolean))
                .map((cellules, j) => (
                  <tr key={j} style={{ borderBottom: '1px solid var(--border)' }}>
                    {cellules.map((c, k) => <td key={k} style={{ padding: '3px 10px 3px 0', verticalAlign: 'top' }}>{c}</td>)}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p key={i} className="text-sm m-0" style={{ whiteSpace: 'pre-line', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{b.lignes.join('\n')}</p>
      ))}
    </div>
  );
}
