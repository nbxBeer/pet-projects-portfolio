'use strict';

const FindGeneratorService = require('./findGeneratorService');

function makeConfig() {
  return {
    nft: { containerChance: 0 },
    findTypes: {
      debris: { weight: 20 },
      artifact: { weight: 20 },
      creature: { weight: 20 },
      anomaly: { weight: 20 },
      asteroid: { weight: 20 },
      nft_container: { weight: 0 },
    },
    rarity: {
      common: { weight: 80 },
      rare: { weight: 15 },
      epic: { weight: 4 },
      legendary: { weight: 0.9 },
      mythical: { weight: 0.1 },
    },
    economy: {
      baseXP: { debris: 10, artifact: 10, creature: 10, anomaly: 10, asteroid: 10 },
    },
    asteroidResources: {
      common: [{ id: 'iron', name: 'Iron', pricePerTon: 1 }],
      rare: [{ id: 'nickel', name: 'Nickel', pricePerTon: 1 }],
      epic: [{ id: 'titanium', name: 'Titanium', pricePerTon: 1 }],
      legendary: [{ id: 'iridium', name: 'Iridium', pricePerTon: 1 }],
      mythical: [{ id: 'antimatter', name: 'Antimatter', pricePerTon: 1 }],
    },
    sectors: ['A'],
    universe2: {
      findTypes: {
        echo: { weight: 30 },
        relic: { weight: 25 },
        entity: { weight: 20 },
        rift: { weight: 20 },
        asteroid: { weight: 5 },
      },
      rarity: {
        exotic: { weight: 85 },
        ancient: { weight: 10 },
        relic: { weight: 3 },
        hybrid: { weight: 1.5 },
        singularity: { weight: 0.5 },
      },
      economy: {
        baseXP: { echo: 10, relic: 10, entity: 10, rift: 10, asteroid: 10 },
      },
      asteroidResources: {
        exotic: [{ id: 'void_iron', name: 'Void Iron', pricePerTon: 1 }],
        ancient: [{ id: 'chrono_titan', name: 'Chrono Titan', pricePerTon: 1 }],
        relic: [{ id: 'aether_earth', name: 'Aether Earth', pricePerTon: 1 }],
        hybrid: [{ id: 'living_platinum', name: 'Living Platinum', pricePerTon: 1 }],
        singularity: [{ id: 'omega_flux', name: 'Omega Flux', pricePerTon: 1 }],
      },
      sectors: ['U2-A'],
    },
  };
}

describe('FindGeneratorService cartographer cross-universe mapping', () => {
  test('maps U1 targetType to U2 equivalent (debris -> echo)', async () => {
    const service = new FindGeneratorService({ config: makeConfig() });
    const zoneU2 = {
      id: 'u2_zone',
      rarityMultiplier: 1,
      findTypeModifiers: { echo: 1, relic: 1, entity: 1, rift: 1, asteroid: 1 },
      creditMultiplier: 1,
      xpMultiplier: 1,
    };

    const result = await service.generate(
      'server-seed-1',
      'client-seed-1',
      zoneU2,
      { level: 0, rarityMultiplier: 1.0, scansUpTo: 0 },
      { cartographer: { metadata: { targetType: 'debris' } } },
      null,
      [],
      2
    );

    expect(result.findType).toBe('echo');
  });

  test('maps U2 targetType to U1 equivalent (entity -> creature)', async () => {
    const service = new FindGeneratorService({ config: makeConfig() });
    const zoneU1 = {
      id: 'u1_zone',
      rarityMultiplier: 1,
      findTypeModifiers: { debris: 1, artifact: 1, creature: 1, anomaly: 1, asteroid: 1 },
      creditMultiplier: 1,
      xpMultiplier: 1,
    };

    const result = await service.generate(
      'server-seed-2',
      'client-seed-2',
      zoneU1,
      { level: 0, rarityMultiplier: 1.0, scansUpTo: 0 },
      { cartographer: { metadata: { targetType: 'entity' } } },
      null,
      [],
      1
    );

    expect(result.findType).toBe('creature');
  });
});

describe('FindGeneratorService creature mass value multiplier', () => {
  test('is bounded and grows sublinearly for very large masses', () => {
    const service = new FindGeneratorService({ config: makeConfig() });

    const small = service._massValueMultiplier(10);
    const medium = service._massValueMultiplier(1000);
    const huge = service._massValueMultiplier(100000);

    expect(small).toBeGreaterThan(1);
    expect(medium).toBeGreaterThan(small);
    expect(huge).toBeGreaterThan(medium);
    expect(huge).toBeLessThanOrEqual(2.2);
  });
});
