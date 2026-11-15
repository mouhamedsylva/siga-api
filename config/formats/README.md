# Formats de SMS et de captures (EF-21)

Un fichier YAML par format. **Les fichiers fournis sont des EXEMPLES** (`example: true`) :
ils doivent être remplacés à partir des vrais SMS et captures collectés en phase 0
(cahier des charges §6.3). Ajouter un opérateur ou un format = ajouter un fichier,
sans toucher au moteur de règles.

```yaml
id: wave-sms-recu-v1        # unique, versionné (-v2 si le format change)
operator: wave              # wave | orange_money
kind: sms                   # sms (message de l'opérateur) | capture (écran de l'appli)
example: true               # true tant que le format n'est pas validé sur des cas réels
detect:                     # TOUTES ces expressions doivent être trouvées dans le texte
  - 'wave'
fields:                     # le 1er groupe capturant donne la valeur
  amount: '...'
  ref: '...'
  datetime: '...'           # optionnel
  sender: '...'             # optionnel, jamais conservé après analyse
required: [amount, ref]
```

Les expressions sont insensibles à la casse et appliquées au texte dont les espaces
multiples ont été réduits à un seul. Chaque format doit avoir des cas de test dans
`src/extraction/parser.spec.ts`.
