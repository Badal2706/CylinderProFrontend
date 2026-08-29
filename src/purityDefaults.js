// F-11 — the impurity table that pre-fills a new Purity Test Certificate.
//
// Kept in its own module rather than inline in App.jsx so the numbers a chemist would want to
// correct are findable in one place, and so App.jsx does not have to be reopened to edit them.
//
// ⚠️ THESE FIGURES ARE NOT TRANSCRIBED FROM GURU INDUSTRIES' OWN CERTIFICATES. The F-11 brief
// referred to a sample impurity table and sample PDFs that were not in the project, so these are
// standard commercial-grade specifications written to give the form a sensible starting point.
// EVERY value here is meant to be checked against a real certificate before the first one is
// issued to a customer. They are only DEFAULTS: the form leaves every field, and every impurity
// row, freely editable, and rows can be added or removed.
//
// A gas with no entry here falls back to a single blank row, so an unknown or newly added gas
// still opens a usable form rather than an empty one.

export const GAS_PURITY_DEFAULTS = {
  'Oxygen': {
    purity_percent: '99.5',
    sub_line: 'Oxygen IP / Industrial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 50 ppm' },
      { name: 'Carbon Dioxide (CO₂)', ppm_text: '< 300 ppm' },
      { name: 'Carbon Monoxide (CO)', ppm_text: '< 10 ppm' },
      { name: 'Nitrogen (N₂)', ppm_text: 'Balance' }
    ]
  },
  'Nitrogen': {
    purity_percent: '99.5',
    sub_line: 'Nitrogen Industrial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 50 ppm' },
      { name: 'Oxygen (O₂)', ppm_text: '< 0.5 %' },
      { name: 'Carbon Dioxide (CO₂)', ppm_text: '< 10 ppm' },
      { name: 'Hydrocarbons', ppm_text: '< 5 ppm' }
    ]
  },
  'Argon': {
    purity_percent: '99.9',
    sub_line: 'Argon Industrial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 20 ppm' },
      { name: 'Oxygen (O₂)', ppm_text: '< 20 ppm' },
      { name: 'Nitrogen (N₂)', ppm_text: '< 100 ppm' },
      { name: 'Hydrocarbons', ppm_text: '< 5 ppm' }
    ]
  },
  'CO2': {
    purity_percent: '99.5',
    sub_line: 'Carbon Dioxide Commercial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 50 ppm' },
      { name: 'Oxygen (O₂)', ppm_text: '< 30 ppm' },
      { name: 'Nitrogen (N₂)', ppm_text: '< 100 ppm' },
      { name: 'Carbon Monoxide (CO)', ppm_text: '< 10 ppm' }
    ]
  },
  'Nitrous Oxide': {
    purity_percent: '98.0',
    sub_line: 'Nitrous Oxide IP',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 50 ppm' },
      { name: 'Nitrogen (N₂)', ppm_text: '< 100 ppm' },
      { name: 'Carbon Monoxide (CO)', ppm_text: '< 10 ppm' },
      { name: 'Higher Oxides of Nitrogen', ppm_text: '< 2 ppm' }
    ]
  },
  'Acetylene': {
    purity_percent: '98.0',
    sub_line: 'Dissolved Acetylene Industrial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 100 ppm' },
      { name: 'Phosphine (PH₃)', ppm_text: '< 50 ppm' },
      { name: 'Hydrogen Sulphide (H₂S)', ppm_text: '< 50 ppm' },
      { name: 'Air', ppm_text: 'Balance' }
    ]
  },
  'Helium': {
    purity_percent: '99.9',
    sub_line: 'Helium Industrial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 20 ppm' },
      { name: 'Oxygen (O₂)', ppm_text: '< 20 ppm' },
      { name: 'Nitrogen (N₂)', ppm_text: '< 100 ppm' },
      { name: 'Hydrocarbons', ppm_text: '< 5 ppm' }
    ]
  },
  'HCL': {
    purity_percent: '99.0',
    sub_line: 'Hydrogen Chloride Commercial Grade',
    declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
    impurities: [
      { name: 'Moisture (H₂O)', ppm_text: '< 100 ppm' },
      { name: 'Air', ppm_text: '< 0.5 %' },
      { name: 'Non-volatile residue', ppm_text: '< 50 ppm' }
    ]
  }
};

// Defaults for one gas type. Always returns a usable object, and always returns FRESH arrays and
// objects — the caller drops these straight into form state and edits them in place, so handing
// back the shared constant would let one certificate's edits leak into the next.
export function purityDefaultsFor(gasType) {
  const d = GAS_PURITY_DEFAULTS[gasType];
  if (!d) {
    return {
      purity_percent: '',
      sub_line: '',
      declaration_text: 'This is to certify that the above mentioned gas has been tested and found to conform to the specification stated herein.',
      impurities: [{ name: '', ppm_text: '' }]
    };
  }
  return {
    purity_percent: d.purity_percent,
    sub_line: d.sub_line,
    declaration_text: d.declaration_text,
    impurities: d.impurities.map(r => ({ name: r.name, ppm_text: r.ppm_text }))
  };
}
