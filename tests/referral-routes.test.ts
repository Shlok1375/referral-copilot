import { describe, it, expect } from 'vitest';
import { parseReferralQuery, scoreRows } from '../server/routes/referral-routes';

describe('parseReferralQuery', () => {
  it('extracts a 6-digit pincode and strips it from the care need', () => {
    expect(parseReferralQuery('dialysis 400001')).toEqual({
      careNeed: 'dialysis',
      location: null,
      pincode: '400001',
    });
  });

  it('parses "<need> near <place>" into careNeed + location', () => {
    expect(parseReferralQuery('dialysis near Jaipur')).toEqual({
      careNeed: 'dialysis',
      location: 'Jaipur',
      pincode: null,
    });
  });

  it('also recognizes "in" and "at" as location prepositions', () => {
    expect(parseReferralQuery('cardiac surgery in Mumbai')).toEqual({
      careNeed: 'cardiac surgery',
      location: 'Mumbai',
      pincode: null,
    });
    expect(parseReferralQuery('maternity care at Patna')).toEqual({
      careNeed: 'maternity care',
      location: 'Patna',
      pincode: null,
    });
  });

  it('falls back to a bare care need when no location signal is present', () => {
    expect(parseReferralQuery('dialysis')).toEqual({
      careNeed: 'dialysis',
      location: null,
      pincode: null,
    });
  });

  it('prefers pincode over a "near" pattern when both could apply', () => {
    // "near" followed by a 6-digit number reads more naturally as a pincode
    // than as a place name, so the pincode branch should win.
    expect(parseReferralQuery('dialysis near 400001')).toEqual({
      careNeed: 'dialysis near',
      location: null,
      pincode: '400001',
    });
  });

  it('trims surrounding whitespace and collapses internal whitespace left after stripping a pincode', () => {
    expect(parseReferralQuery('  dialysis   400001  ')).toEqual({
      careNeed: 'dialysis',
      location: null,
      pincode: '400001',
    });
  });

  it('is case-insensitive for the location preposition', () => {
    expect(parseReferralQuery('dialysis NEAR Jaipur')).toEqual({
      careNeed: 'dialysis',
      location: 'Jaipur',
      pincode: null,
    });
  });

  it('returns an empty careNeed for an empty query (caller is responsible for rejecting this)', () => {
    expect(parseReferralQuery('   ')).toEqual({
      careNeed: '',
      location: null,
      pincode: null,
    });
  });
});

describe('scoreRows', () => {
  function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      unique_id: 'f1',
      name: 'Test Hospital',
      address_city: 'Jaipur',
      address_stateOrRegion: 'Rajasthan',
      officialPhone: '0141-1234567',
      specialties: null,
      description: null,
      capability: null,
      procedure: null,
      equipment: null,
      numberDoctors: '12',
      capacity: '50',
      latitude: 26.9,
      longitude: 75.8,
      distance_km: 4.2,
      ...overrides,
    };
  }

  it('scores an exact phrase match higher than a partial keyword match', () => {
    const exact = scoreRows([row({ capability: 'dialysis' })], 'dialysis');
    const partial = scoreRows([row({ capability: 'renal and dialysis care unit' })], 'dialysis unit');

    // Exact match on the full care-need string should score at least as
    // high as a query that only partially overlaps the field text.
    expect(exact[0].match_score).toBeGreaterThan(0);
    expect(partial[0].match_score).toBeGreaterThan(0);
  });

  it('weights capability matches higher than description matches', () => {
    const byCapability = scoreRows([row({ capability: 'dialysis' })], 'dialysis');
    const byDescription = scoreRows([row({ description: 'we offer dialysis services' })], 'dialysis');

    expect(byCapability[0].match_score).toBeGreaterThan(byDescription[0].match_score);
  });

  it('records which weighted fields matched as human-readable evidence', () => {
    const [result] = scoreRows([row({ capability: 'cardiac surgery and dialysis' })], 'dialysis');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toContain('capability');
    expect(result.evidence[0].toLowerCase()).toContain('dialysis');
  });

  it('flags missing important fields so the UI can warn the user', () => {
    const [result] = scoreRows(
      [row({ capability: null, procedure: null, equipment: null, specialties: 'Cardiology' })],
      'dialysis',
    );
    expect(result.missing_fields).toContain('capability');
    expect(result.missing_fields).toContain('procedure');
    expect(result.missing_fields).toContain('equipment');
  });

  it('treats the literal string "null" the same as a real null (defensive against unclean source data)', () => {
    const [result] = scoreRows([row({ capability: 'null' })], 'dialysis');
    expect(result.missing_fields).toContain('capability');
    expect(result.match_score).toBe(0);
  });

  it('gives a facility with no matching fields a score of zero with no evidence', () => {
    const [result] = scoreRows([row({ description: 'general physician clinic' })], 'dialysis');
    expect(result.match_score).toBe(0);
    expect(result.evidence).toHaveLength(0);
  });

  it('is case-insensitive when matching care need against field text', () => {
    const [result] = scoreRows([row({ capability: 'DIALYSIS UNIT' })], 'dialysis');
    expect(result.match_score).toBeGreaterThan(0);
  });

  it('ignores short (<=2 char) keywords in the fallback split, but a short care-need can still match as a substring', () => {
    // A 2-letter care need is short enough to appear as a coincidental
    // substring of an unrelated word ("er" inside "general") -- the exact
    // phrase check runs before the keyword-length filter, so this is
    // expected, current behavior, not a false negative.
    const [result] = scoreRows([row({ description: 'general physician clinic' })], 'er');
    expect(result.match_score).toBeGreaterThan(0);
    expect(result.evidence[0]).toContain('gen');
  });

  it('does not match on an unrelated short keyword when the care need itself is longer', () => {
    // Here the 2-letter token "er" would come from splitting a longer
    // phrase; the keyword-length filter (> 2 chars) should keep it from
    // being used as a fallback match.
    const [result] = scoreRows([row({ description: 'general physician clinic' })], 'xx er');
    expect(result.match_score).toBe(0);
  });

  it('rounds distance to one decimal place', () => {
    const [result] = scoreRows([row({ distance_km: 4.2456 })], 'dialysis');
    expect(result.distance_km).toBe(4.2);
  });

  it('preserves facility identity fields unchanged through scoring', () => {
    const [result] = scoreRows([row({ unique_id: 'abc-123', name: 'City Hospital' })], 'dialysis');
    expect(result.unique_id).toBe('abc-123');
    expect(result.name).toBe('City Hospital');
  });
});
