# Une itération : classe les éléments d'une version candidate (si besoin), les fait
# juger par le panel (Sonnet et Haiku en lot, Luna en direct, en parallèle), puis mesure.
#   sh iterer.sh <version> [dev|test|tout]
cd "$(dirname "$0")"
V=$1
M=${2:-dev}
python3 classer.py $V $M 2>&1 | tail -1
python3 juge_claude.py lot $V $M 1.5 2>&1 | tail -1 &
JUGE_MODELE=claude-haiku-5-5 python3 juge_claude.py lot $V $M 0.5 claude-haiku-5-5 2>&1 | tail -1 &
python3 juge_claude.py luna $V $M 0.3 2>&1 | tail -1 &
wait
python3 mesure.py $V $M panel
