# Itération en double : la version et sa jumelle (même consigne, seconde passe de Haiku),
# pour moyenner le bruit d'une passe à l'autre (5 points constatés sur v0 / v0bis).
#   sh deux.sh <version> [dev|test]
cd "$(dirname "$0")"
cp candidats/$1.json candidats/$1_b.json
sh iterer.sh $1 ${2:-dev} > iter_$1.log 2>&1 &
sh iterer.sh $1_b ${2:-dev} > iter_$1_b.log 2>&1 &
wait
python3 moyenne.py $1 ${2:-dev}
