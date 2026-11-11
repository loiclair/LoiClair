# Étape 6b : panel sur les 150 classements de Luna (consigne v7), puis 3 juges Mammouth sur le test.
cd "$(dirname "$0")"
python3 juge_claude.py lot luna_v7 tout 1.5 2>&1 | tail -1 &
JUGE_MODELE=claude-haiku-5-5 python3 juge_claude.py lot luna_v7 tout 0.5 claude-haiku-5-5 2>&1 | tail -1 &
python3 juge_claude.py luna luna_v7 tout 0.3 2>&1 | tail -1 &
python3 mammouth.py luna_v7 1.2 test 2>&1 | tail -1 &
wait
for M in dev test; do python3 mesure.py luna_v7 $M panel | head -1; done
python3 mesure.py luna_v7 test mammouth
