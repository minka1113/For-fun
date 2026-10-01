// Common home maintenance jobs to start from. `month` (1–12) suggests when the first one is due.

import type { Unit } from "./types.js";

export interface Template {
  name: string;
  area: string;
  every: number;
  unit: Unit;
  month?: number;
  notes: string;
}

export const LIBRARY: Template[] = [
  // HVAC
  { name: "Replace HVAC air filter", area: "HVAC", every: 3, unit: "month", notes: "Check the size printed on the old filter. Change monthly if you have pets or allergies." },
  { name: "Furnace / heating service", area: "HVAC", every: 1, unit: "year", month: 9, notes: "Professional tune-up before the heating season: burners, heat exchanger, CO check." },
  { name: "Air conditioner service", area: "HVAC", every: 1, unit: "year", month: 4, notes: "Professional tune-up before summer. Clear debris from around the outdoor unit." },
  { name: "Clean bathroom exhaust fans", area: "HVAC", every: 1, unit: "year", notes: "Vacuum the grille and fan blades." },

  // Safety
  { name: "Test smoke & CO alarms", area: "Safety", every: 1, unit: "month", notes: "Press the test button on every alarm." },
  { name: "Replace smoke & CO alarm batteries", area: "Safety", every: 1, unit: "year", month: 11, notes: "A common habit is to do this when the clocks change. Replace alarms over 10 years old." },
  { name: "Check fire extinguishers", area: "Safety", every: 1, unit: "year", notes: "Gauge in the green, pin and seal intact, no damage." },
  { name: "Clean dryer vent duct", area: "Safety", every: 1, unit: "year", notes: "Lint build-up is a fire risk. Clean the duct all the way to the outside flap." },
  { name: "Chimney inspection & sweep", area: "Safety", every: 1, unit: "year", month: 8, notes: "Before the first fire of the season." },
  { name: "Test GFCI outlets", area: "Electrical", every: 1, unit: "month", notes: "Press TEST then RESET on kitchen, bath, garage and outdoor outlets." },

  // Plumbing
  { name: "Flush water heater", area: "Plumbing", every: 1, unit: "year", notes: "Drain a few gallons from the valve at the bottom to clear sediment." },
  { name: "Test water heater relief valve", area: "Plumbing", every: 1, unit: "year", notes: "Lift the lever briefly. Water should flow and then stop." },
  { name: "Check for leaks under sinks", area: "Plumbing", every: 3, unit: "month", notes: "Also check behind the toilet and around the dishwasher and washing machine." },
  { name: "Replace water filter", area: "Plumbing", every: 6, unit: "month", notes: "Fridge, under-sink or whole-house filter." },
  { name: "Inspect washing machine hoses", area: "Plumbing", every: 1, unit: "year", notes: "Look for bulges or cracks. Replace rubber hoses every 5 years." },
  { name: "Test sump pump", area: "Plumbing", every: 1, unit: "year", month: 3, notes: "Pour water into the pit and check that the pump starts, before the spring rains." },

  // Appliances
  { name: "Clean refrigerator coils", area: "Appliances", every: 1, unit: "year", notes: "Vacuum the coils behind or under the fridge." },
  { name: "Clean dishwasher filter", area: "Appliances", every: 1, unit: "month", notes: "Remove and rinse the filter at the bottom of the tub." },
  { name: "Clean range hood filter", area: "Appliances", every: 3, unit: "month", notes: "Soak in hot water and degreaser." },

  // Exterior / roof
  { name: "Clean gutters & downspouts", area: "Roof & gutters", every: 6, unit: "month", month: 10, notes: "Once after the leaves fall and once in spring." },
  { name: "Inspect roof", area: "Roof & gutters", every: 1, unit: "year", month: 5, notes: "Look for missing or damaged shingles and failed flashing. Use binoculars from the ground." },
  { name: "Check caulk & weatherstripping", area: "Exterior", every: 1, unit: "year", month: 9, notes: "Windows, doors and the tub/shower. Re-seal any gaps before winter." },
  { name: "Power-wash deck & siding", area: "Exterior", every: 1, unit: "year", month: 5, notes: "Re-seal the deck every 2–3 years." },
  { name: "Inspect foundation & grading", area: "Exterior", every: 1, unit: "year", month: 4, notes: "Look for cracks, and check that soil slopes away from the house." },

  // Seasonal / yard
  { name: "Winterize outdoor faucets & irrigation", area: "Seasonal", every: 1, unit: "year", month: 10, notes: "Disconnect hoses, shut off the inside valves and blow out the sprinklers." },
  { name: "Start up irrigation system", area: "Yard & garden", every: 1, unit: "year", month: 4, notes: "Turn the water back on slowly and check each zone for broken heads." },
  { name: "Service lawn mower", area: "Yard & garden", every: 1, unit: "year", month: 3, notes: "Oil, air filter, spark plug, sharpen the blade." },
  { name: "Trim trees & shrubs away from house", area: "Yard & garden", every: 1, unit: "year", month: 2, notes: "Keep branches at least a few feet from the roof and siding." },

  // Interior
  { name: "Deep-clean carpets", area: "Interior", every: 1, unit: "year", notes: "" },
  { name: "Check attic for leaks & pests", area: "Interior", every: 1, unit: "year", month: 11, notes: "Look for water stains, droppings and damaged insulation." },
];
