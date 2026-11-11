// Layout des pages `/newsletter/*`. Il leur donne une minuterie et les traductions
// `newsletter` qu'elles lisent côté client (TRADUCTIONS_PAR_ROUTE).
// Minuterie : `/newsletter` lit en base le nombre d'abonnés, et le badge du pied de
// page date le dernier run de nuit ; sans minuterie, tous deux garderaient la valeur
// du déploiement. La valeur est posée ici et non page par page parce que `confirmer`
// et `desabonner` sont des composants client, qui ne peuvent pas exporter `revalidate`.
import { layoutTraductions } from "@/i18n/layout-traductions"

export const revalidate = 86400

export default layoutTraductions("(app)/newsletter")
