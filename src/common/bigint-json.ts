/**
 * Les identifiants sont des BIGINT : sans ceci, JSON.stringify lève une erreur.
 * Ils sont sérialisés en chaîne pour éviter toute perte de précision côté client.
 */
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function (this: bigint) {
  return this.toString();
};

export {};
