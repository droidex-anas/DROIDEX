export const acceptedCronExpressions = [
  '* * * * *',
  ' \t05\t09 1 12 0\n',
  '45,10,10 13,12 * * *',
  '*/15 8-18/2 * * 1-5',
  '5/2 12 * * *',
  '59 23 31 12 7',
  '0 9 * * 5-7/2',
  '0 9 */1 * 7',
  '0 0 30 2 *',
];

export const rejectedCronExpressions = [
  ['', 'Use a five-field cron expression.', 'Cron expressions must contain five fields.'],
  ['* * * *', 'Use a five-field cron expression.', 'Cron expressions must contain five fields.'],
  [
    '* * * * * *',
    'Use a five-field cron expression.',
    'Cron expressions must contain five fields.',
  ],
  ['60 24 * * *', '“60” is not a valid cron minute field.', 'Invalid cron field: 60'],
  ['* 24 * * *', '“24” is not a valid cron hour field.', 'Invalid cron field: 24'],
  ['* * 0 * *', '“0” is not a valid cron day of month field.', 'Invalid cron field: 0'],
  ['* * * 13 *', '“13” is not a valid cron month field.', 'Invalid cron field: 13'],
  ['* * * * 8', '“8” is not a valid cron weekday field.', 'Invalid cron field: 8'],
  ['* * * * MON', '“MON” is not a valid cron weekday field.', 'Invalid cron field: MON'],
  ['0,5, * * * *', '“0,5,” is not a valid cron minute field.', 'Invalid cron field: '],
  ['9-5 * * * *', '“9-5” is not a valid cron minute field.', 'Invalid cron field: 9-5'],
  ['*/0 * * * *', '“*/0” is not a valid cron minute field.', 'Invalid cron step: */0'],
  ['*/2/3 * * * *', '“*/2/3” is not a valid cron minute field.', 'Invalid cron field: */2/3'],
  [
    '0,*/9007199254740992 * * * *',
    '“0,*/9007199254740992” is not a valid cron minute field.',
    'Invalid cron field: */9007199254740992',
  ],
] as const;
