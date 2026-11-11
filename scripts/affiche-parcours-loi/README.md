# Affiche « Le parcours d'une loi »

Sources du PDF `public/parcours-dune-loi.pdf`, proposé en téléchargement au bas
de la section « Le parcours d'une loi » de `/processus-legislatif`.

## Régénérer

```bash
python3 scripts/affiche-parcours-loi/build.py
```

Le script écrit directement dans `public/`, et échoue si le contenu ne tient
plus sur une page. Il lui faut Google Chrome et un accès réseau : les polices
IBM Plex viennent de Google Fonts, et sans elles la mise en page change.

## Les trois fichiers

| Fichier | Rôle |
| --- | --- |
| `build_flow.py` | Calcule le schéma de la navette : les 925 sièges des deux hémicycles, et les coordonnées du graphe qui se dérivent d'une poignée de constantes en tête de fichier. Produit `flow.svg`. |
| `shell.html` | La feuille A4 elle-même : en-tête, cartes d'origine, frise de fin, raccourcis. Le schéma s'y injecte à la place du marqueur `<!--FLOW-->`. |
| `build.py` | Enchaîne les deux, imprime le PDF, vérifie la pagination. |

## Ce qui se casse facilement

**La feuille doit tenir sur une page, et rien ne le signale.** Tout est
dimensionné en pixels dans un cadre A4 (210 mm = 793 px à 96 dpi). Rallonger un
texte d'une ligne suffit à déborder, et le `overflow: hidden` posé en sécurité
sur la feuille rogne alors le bas **en silence** : le PDF continue d'annoncer
une seule page pendant que le pied de page est coupé. C'est pour cela que
`build.py` regénère un second PDF sans ce masque et compte ses pages ; c'est le
seul contrôle qui ne ment pas, et il fait échouer le build.

**Gagner de la place se fait en retirant du contenu, pas en tassant les
marges.** Les écarts actuels sont le résultat d'un arbitrage : les resserrer
rend la page illisible bien avant de rendre assez de hauteur.

**Le langage couleur porte de l'information** : le teal est l'Assemblée
nationale, l'or est le Sénat, et une étape qui n'appartient à aucune des deux
chambres (la commission mixte paritaire) est centrée et neutre. La position
horizontale dit la même chose que la couleur, il faut donc que les deux
restent d'accord : c'est ce qui rendait faux un bloc « dernier mot » placé du
côté du Sénat alors que l'Assemblée y tranche seule.

## Langue

Le document n'existe qu'en français, et le lien de téléchargement n'est rendu
que pour cette locale (`page.tsx` de `/processus-legislatif`). Les clés
`process.poster.*` n'existent donc que dans `fr.json`. Le jour où une version
anglaise est produite, il faut lever la condition sur la locale **et** ajouter
les clés dans `en.json`, sinon les libellés s'affichent en identifiants bruts.
