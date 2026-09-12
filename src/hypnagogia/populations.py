"""Canonical target populations, with the source of each identification.

Selectors are dicts consumed by Connectome.select(**sel). Type names follow the male CNS v1.0
annotation table (which reuses hemibrain / FlyWire nomenclature: Schlegel et al. 2024; Li et al.
2020; Hulse et al. 2021). Every entry records where the identification comes from; the
cross-match report (crossmatch.py) validates each against its FlyWire v783 counterpart.
"""
POPULATIONS = {
    "KC": {"selector": {"cell_class": "Kenyon_Cell"},
           "flywire_selector": {"cell_class": "Kenyon_Cell"},
           "source": "class == 'Kenyon_Cell' (male CNS annotations; FlyWire cell_class 'Kenyon_Cell', Schlegel et al. 2024)"},
    "MBON": {"selector": {"cell_class": "MBON"}, "flywire_selector": {"cell_class": "MBON"},
             "source": "class == 'MBON' (Aso et al. 2014 nomenclature MBON01-35; Li et al. 2020)"},
    "PAM": {"selector": {"cell_type": {"regex": r"^PAM\d\d"}}, "flywire_selector": {"cell_type": {"regex": r"^PAM\d\d"}},
            "source": "type PAM01-PAM15 (Aso et al. 2014; Li et al. 2020)"},
    "PPL1": {"selector": {"cell_type": {"regex": r"^PPL1\d\d"}}, "flywire_selector": {"cell_type": {"regex": r"^PPL1\d\d"}},
             "source": "type PPL101-PPL108 (Aso et al. 2014; Li et al. 2020)"},
    "DAN": {"selector": {"cell_class": "DAN"}, "flywire_selector": {"cell_class": "DAN"},
            "source": "class == 'DAN' (PAM + PPL1 mushroom-body dopaminergic neurons)"},
    "ORN": {"selector": {"cell_type": {"regex": r"^ORN_"}}, "flywire_selector": {"cell_type": {"regex": r"^ORN_"}},
            "source": "type ORN_<glomerulus> (olfactory receptor neurons, 53 glomerular types)"},
    # dorsal fan-shaped body sleep-promoting tangential types = R23E10 population matched to EM by
    # Hulse et al. 2021 eLife 10:e66039 (Fig. 48): FB6A, FB6C_a, FB6C_b, FB6E, FB6G, FB6I, FB6Z (high-quality),
    # FB7A, FB7K (layer 7, FB7K moderate).  Male CNS splits FB6A into FB6A_a/_b/_c.
    "dFB": {"selector": {"cell_type": {"regex": r"^(FB6A(_[abc])?|FB6C(_[ab])?|FB6E|FB6G|FB6I|FB6Z|FB7A|FB7K)$"}},
            "flywire_selector": {"cell_type": {"regex": r"^(FB6A(_[abc])?|FB6C(_[ab])?|FB6E|FB6G|FB6I|FB6Z|FB7A|FB7K)$"}},
            "source": "Hulse et al. 2021 eLife 10:e66039 Fig. 48 (R23E10 -> FB6A, FB6C_a/b, FB6E, FB6G, FB6I, FB6Z, FB7A, FB7K)"},
    "dFB_core": {"selector": {"cell_type": {"regex": r"^(FB6A(_[abc])?|FB6C(_[ab])?|FB6E|FB6G|FB6I|FB6Z)$"}},
                 "flywire_selector": {"cell_type": {"regex": r"^(FB6A(_[abc])?|FB6C(_[ab])?|FB6E|FB6G|FB6I|FB6Z)$"}},
                 "source": "Hulse et al. 2021: layer-6 high-quality LM-EM matches only"},
    # wake-promoting PPL1 dopaminergic dFB tangentials (Hulse et al. 2021; Pimentel et al. 2016) - excluded from 'sleep' drive
    "dFB_wake_DAN": {"selector": {"cell_type": ["FB5H", "FB6H", "FB7B"]}, "flywire_selector": {"cell_type": ["FB5H", "FB6H", "FB7B"]},
                     "source": "Hulse et al. 2021 (FB5H, FB6H, FB7B = PPL1 dopaminergic dFB inputs that switch dFB neurons OFF)"},
    "MN9": {"selector": {"cell_type": "MN9"}, "flywire_selector": {"cell_type": "CB0701"},
            "source": "type 'MN9' (proboscis motor neuron 9; FlyWire CB0701 = Shiu et al. 2024 MN9 720575940660219265)"},
    # labellar sugar/water GRNs: FlyWire cell_type LB3 (cell_sub_class 'sugar/water'); male CNS splits LB3a-d
    "sugar_GRN": {"selector": {"cell_type": {"regex": r"^LB3[a-d]?$"}}, "flywire_selector": {"cell_type": "LB3"},
                  "source": "type LB3a-LB3d (labellar bristle GRNs matched to FlyWire LB3 'sugar/water', Schlegel et al. 2024; Shiu et al. 2024 sugar GRNs are FlyWire LB3)"},
    "APL": {"selector": {"cell_type": "APL"}, "flywire_selector": {"cell_type": "APL"}, "source": "type APL"},
    "ALPN": {"selector": {"cell_class": "ALPN"}, "flywire_selector": {"cell_class": "ALPN"}, "source": "class ALPN (antennal lobe projection neurons)"},
    "CX": {"selector": {"cell_class": "CX"}, "flywire_selector": {"cell_class": "CX"}, "source": "class CX (central complex)"},
}

# Neurons that do not fire action potentials and release transmitter continuously in proportion to membrane
# depolarisation. APL: Amin H, Apostolopoulou AA, Suarez-Grimalt R, Vrontou E, Lin AC (2020) "Localized
# learning-related plasticity in the mushroom body of adult Drosophila" / Amin & Lin, eLife 9:e56954 report that
# APL does not fire action potentials. Modelling it as a spiking neuron turns the mushroom body's graded gain
# control into a saturated binary relay.
NON_SPIKING = {
    "APL": {"selector": {"cell_type": "APL"},
            "source": "Amin et al. 2020 eLife 9:e56954: APL does not fire action potentials; release is graded"},
}


# 'MB + CX + olfactory pathway' subset used for fast iteration
SUBSET_MB_CX = {
    "name": "mb_cx",
    "selectors": [
        {"cell_type": {"regex": r"^ORN_"}}, {"cell_class": "ALPN"}, {"cell_class": "ALLN"}, {"cell_class": "ALIN"}, {"cell_class": "ALON"},
        {"cell_class": "Kenyon_Cell"}, {"cell_class": "MBON"}, {"cell_class": "DAN"}, {"cell_type": ["APL", "DPM"]},
        {"cell_class": "CX"}, {"cell_type": {"regex": r"^(FB|ER|EL|ExR|PF|hDelta|vDelta|FC|FR|FS|EPG|PEG|PEN|LNO|LCNO|SA|IbSpsP|SpsP|PFL|PFR|LPsP|OA-VPM3|OA-VPM4)"}},
    ],
}


# Neurons whose transmitter in the connectome's own annotation is contradicted by a direct published
# measurement on that identified cell. The model's sign rule is not changed: the published transmitter is
# substituted for the predicted one and the SAME rule is applied to it, so no free parameter is introduced.
#
# DPM (dorsal paired medial, one per hemisphere) is annotated 'dopamine' by the male CNS v1.0 consensus
# transmitter, which the Shiu sign rule maps to +1, making its 32,795 synapses onto 3,989 of the 4,064 Kenyon
# cells excitatory. Haynes PR, Christmann BL, Waddell S (2015) eLife 4:e03868 show that DPM cell bodies stain
# for Gad1, that DPM contains GABA and 5-HT, and that activating DPM drives a large chloride increase in
# mushroom-body neurons with no detectable calcium or cAMP increase, i.e. its action on Kenyon cells is
# inhibitory. Lee P-T et al. (2011) PNAS 108:13794 independently report DPM as serotonergic. Neither
# transmitter is dopamine, and the measured postsynaptic effect is inhibition, so the rule's 'gaba' -> -1 is
# the assignment the published measurement implies.
NT_CORRECTIONS = {
    "DPM": {"selector": {"cell_type": "DPM"},
            "annotated_nt": "dopamine", "annotated_sign": +1,
            "measured_nt": "gaba", "corrected_sign": -1,
            "source": ("Haynes PR, Christmann BL, Waddell S (2015) eLife 4:e03868: DPM cell bodies are Gad1-positive, "
                       "DPM contains GABA and 5-HT, and DPM activation evokes a large chloride increase in mushroom-body "
                       "neurons with no detectable calcium or cAMP increase; Lee P-T et al. (2011) PNAS 108:13794 report "
                       "DPM as serotonergic. The connectome's consensus transmitter for DPM is 'dopamine'.")},
}


# LABELLED DEVIATIONS to the synaptic substrate. These are NOT corrections. A correction substitutes a
# measured fact for a predicted one and applies the model's own existing rule to it, as the APL and DPM
# entries above do, and introduces nothing. An entry here changes what the model treats as a synapse on the
# strength of a measurement that does not fully determine the change, so every one of them is a deviation and
# has to be labelled wherever its results appear, the way the synaptic gain multiplier is.
#
# Each entry states the measurement, what the measurement does NOT establish, and the scope the evidence
# actually covers, so that the gap between the two is visible rather than buried.
SYNAPSE_DEVIATIONS = {
    "kc_kc_axonal_not_nicotinic": {
        "what": ("Remove the fast excitatory conductance from Kenyon-cell to Kenyon-cell synapses located in "
                 "the mushroom body LOBES whose postsynaptic cell is an alpha/beta or gamma Kenyon cell."),
        "measurement": (
            "Manoim JE, Davidson AM, Weiss S, Hige T, Parnas M (2022) 'Lateral axonal modulation is required "
            "for stimulus-specific olfactory conditioning in Drosophila', Current Biology 32(20):4438-4450.e5, "
            "doi:10.1016/j.cub.2022.09.007, PMID 36130601, PMC9613607. Figure 6: optogenetically activating "
            "17 to 22% of Kenyon cells DECREASES odour responses in the Kenyon cells not activated, and "
            "knocking down the metabotropic receptor mAChR-B abolishes that suppression without unmasking any "
            "facilitation. The authors' own conclusion, verbatim: 'our Ca2+ imaging demonstrated that the net "
            "effect of those cholinergic transmissions is, in fact, inhibitory.' Figure 5A: with TTX in the "
            "bath, acetylcholine puffed at Kenyon-cell axons reduces cAMP, and mAChR-B knockdown suppresses "
            "that, so the transmitter does act on the axons and it acts through a Gi/o-coupled receptor. "
            "Figure 1: mAChR-B localises to the axonal lobes and somata and NOT to the calyx dendrites, and is "
            "expressed in alpha/beta and gamma but not alpha'/beta' Kenyon cells."),
        "why_it_is_a_deviation_and_not_a_correction": (
            "Three reasons, each sufficient. (1) Every relevant measurement is optical, calcium or cAMP; nobody "
            "has voltage-clamped a Kenyon cell and looked for a current evoked by another Kenyon cell, so the "
            "absence of a fast component is an inference and not a measurement. Gu H & O'Dowd DK (2006) "
            "J Neurosci 26(1):265-272 do measure conductance and find Kenyon cells have functional "
            "alpha-bungarotoxin-sensitive nicotinic receptors; nothing localises them, so calyx-only is "
            "consistent but unproven. (2) The measured replacement for the removed excitation is not nothing, "
            "it is a slow weak Gi/o-coupled suppression, and this model has no mechanism for that; zero is "
            "closer to the data than the current +1 but it still discards a real measured interaction. "
            "(3) No magnitude is reported anywhere, so nothing fixes how much to remove, and removing all of "
            "it is a choice."),
        "scope_the_evidence_covers": (
            "The lateral suppression was measured in gamma Kenyon cells. alpha/beta showed no measurable "
            "lateral effect, which the authors attribute to fewer connections or to knockdown efficiency, and "
            "alpha'/beta' do not express the receptor at all, so their synapses are left alone here. The "
            "pedunculus is covered by no measurement in either paper and is also left alone; the only prior "
            "report of Kenyon-cell to Kenyon-cell chemical synapses in any insect (Leitch & Laurent 1996, "
            "locust) was in the pedunculus, cited here secondhand via Takemura et al. 2017."),
        "do_not_cite": (
            "Barnstedt et al. 2016 Neuron 89:1237 is often cited for this. Its Figure S3F is a single "
            "unquantified supplementary control panel with no stated n, its authors make no claim about "
            "Kenyon-cell to Kenyon-cell synapses anywhere in the paper, and it puffed the lobe neuropil rather "
            "than targeting axons. It is supporting evidence, not the primary source."),
        "region": "lobe",
        "exclude_postsynaptic_types_matching": r"^KCa'b'",
        "edge_table": "results/stage8_kc_kc/kc_kc_edges_by_region.npz",
    },
}


# LABELLED DEVIATIONS to the neuron model itself, as distinct from the synaptic substrate above.
#
# The published model (Shiu, Sterne, Spiller et al. 2024, Nature 634:210-219) is a plain leaky
# integrate-and-fire cell with one membrane time constant and one synaptic time constant, and stage 11
# measured what that costs: with no state variable slower than tau_syn = 5 ms, an active state has nothing
# that can terminate it. Over 18 runs at four noise levels and injected recurrence from 1x to 300x, the
# network was silent, or permanently on, or it ignited exactly once and never switched off. It cannot
# represent an episode, which is the shape memory replay has.
#
# An entry here adds a mechanism the published model does not have. That is a larger step than any synaptic
# deviation, so the bar is correspondingly higher: every constant carries its own provenance, a constant with
# no measurement behind it is marked unsourced and must be SCANNED rather than chosen, and every figure,
# table and sentence derived from a run with one of these switched on says so.
MECHANISM_DEVIATIONS = {
    "short_term_depression_excitatory": {
        "what": ("Make excitatory synapses depress with use. Each arriving spike delivers the synapse's "
                 "weight times a resource variable A and then multiplies A by f; between spikes A recovers "
                 "exponentially toward 1 with time constant tau. Both constants are measured. Which "
                 "synapses it is applied to is NOT measured, and is reported as an arm."),
        "constants": {
            "f": {"what": "fraction of the releasable resource left after one spike", "status": "measured"},
            "tau_ms": {"what": "recovery time constant of the resource", "status": "measured"},
            "scope": {"what": "which synapses depress", "status": "NOT MEASURED, reported as an arm"},
        },
        # Three independent fits, two laboratories, two postsynaptic cell types, all in the adult antennal
        # lobe. The per-spike factor agrees to within 8% across all three; the recovery time constant spans
        # 2.7x, which is a bracket between measured endpoints and not a free parameter.
        "measurement": [
            {"synapse": "ORN->PN, glomeruli DM6 and VM2", "f": 0.78, "tau_ms": 893, "n": "19 PNs from 19 flies",
             "source": ("Nagel KI, Hong EJ, Wilson RI (2015) Nature Neuroscience 18:56-65, "
                        "DOI 10.1038/nn.3895, PMID 25485755. Fit to mean normalised EPSC amplitudes "
                        "during a 10 Hz train.")},
            {"synapse": "ORN->LN (GABAergic antennal-lobe local neurons)", "f": 0.75, "tau_ms": 1566, "n": "9 LNs",
             "source": ("Nagel KI, Wilson RI (2016) Journal of Neuroscience 36:4325-4338, "
                        "DOI 10.1523/JNEUROSCI.3887-15.2016. Fit to mean normalised EPSC amplitudes "
                        "during a 10 Hz train.")},
            {"synapse": "ORN->PN, glomerulus DM4", "f": 0.72, "tau_ms": 2400, "n": "not stated in the entry",
             "source": ("Kazama H, Wilson RI (2009) Nature Neuroscience 12:1136-1144, DOI 10.1038/nn.2376, "
                        "PMID 19684589.")},
        ],
        "status": "constants measured, scope declared",
        "why_it_is_a_deviation_and_not_a_correction": (
            "The published model has no synaptic dynamics beyond a 5 ms conductance decay, and adding "
            "depression changes what a synapse is, so no run with it switched on is a property of the "
            "published model. Beyond that, the measurements are at ORN to PN and ORN to LN synapses only. "
            "Applying the same two constants to any other synapse is an extrapolation the measurements do "
            "not license, which is why the scope is an arm of the experiment and not a setting."),
        "how_it_must_be_reported": (
            "The two constants are cited. The scope is stated in the same sentence as any number derived "
            "from it, and results are given for every scope arm run, not only the one that worked."),
        "why_this_mechanism_for_this_failure": (
            "Depression is rate-selective, and the offline state's problem is a rate. At the measured "
            "constants the steady-state weight scaling A* = (1 - exp(-1/(r*tau))) / (1 - f*exp(-1/(r*tau))) "
            "removes 94 to 99 per cent of the excitatory drive from the antennal-lobe populations that run "
            "away at 122 and 75 Hz, and 2 to 14 per cent from the Kenyon cells at 0.42 Hz whose "
            "reactivation is the thing being measured. Nothing was chosen to make that happen: it follows "
            "from the measured constants and the model's own measured rates. Depression also acts on the "
            "recurrent excitatory loop that carries the runaway, which is where a slow negative feedback "
            "has to act to turn a bistable switch into a relaxation oscillator."),
    },
    "apl_slow_ahp": {
        "what": ("Give APL, the mushroom body's feedback inhibitory neuron, a slow afterhyperpolarisation: a "
                 "low-pass of its own depolarisation, with the measured time constant, subtracted from its "
                 "membrane drive. APL does not spike, so the driving variable is depolarisation and not spike "
                 "count, which is what the measurement itself describes."),
        "constants": {
            "tau_ms": {"what": "decay time constant of the afterhyperpolarisation", "value": 491.1,
                       "sem": 72.17, "status": "measured"},
            "gain": {"what": "how much hyperpolarisation a given depolarisation eventually produces",
                     "status": "NOT MEASURED, scanned"},
        },
        "measurement": (
            "Chen CC, Huang YC, Ortega A, Suarez-Grimalt R, Tedre E, Baz ES, Wu Y, Lin AC, Liu S (2026) "
            "'Sleep facilitates pattern separation through SK channel-mediated sparse coding', Current Biology "
            "36(7):1633-1643.e6, DOI 10.1016/j.cub.2026.02.028, PMID 41844155, PMC13075853. Adult Drosophila, "
            "ex vivo brain, whole-cell current clamp, AHP elicited by 1 nA depolarising injection: 'The decay "
            "time constant of the enhanced AHP is 491.1 +/- 72.17 ms (mean +/- SEM)'. Sleep deprivation "
            "enhances the AHP and recovery sleep reduces it, and the SK dependence is established with "
            "NS8593 and with APL-specific SK RNAi."),
        "what_the_measurement_does_not_establish": (
            "Three things, all of which matter. The 491.1 ms fit is from the SLEEP-DEPRIVED condition only: "
            "the authors state that exponential fitting was unreliable in the normally-slept group, so there "
            "is no measured baseline time constant. No amplitude is printed anywhere in the paper, in mV or "
            "in nS, so the gain is unsourced and is scanned rather than chosen. And the driving function, "
            "depolarisation rather than calcium, is a modelling choice the paper does not dictate."),
        "status": "time constant measured, gain scanned",
        "why_it_is_a_deviation_and_not_a_correction": (
            "It adds a mechanism the published model does not have, so no run with it switched on is a "
            "property of that model. The same paper does independently confirm the correction this project "
            "already applies to APL from Amin et al. 2020, in its own words: 'APL neurons are non-spiking and "
            "exhibit graded responses to somatic current injection'."),
        "how_it_must_be_reported": (
            "The time constant is cited. The gain is reported as the range scanned, never as a value, for as "
            "long as no measurement exists for it."),
    },
    "spike_frequency_adaptation": {
        "what": ("Give every spiking neuron one extra state variable: a hyperpolarising term that steps up "
                 "by b_mV each time that cell fires and decays exponentially with tau_ms, subtracted from "
                 "the membrane drive. This is spike-triggered adaptation, the 'b' of an adaptive "
                 "exponential integrate-and-fire cell, and it is the only quantity in the model slower than "
                 "the 5 ms synaptic time constant."),
        "constants": {
            "tau_ms": {"what": "decay time constant of the adaptation term", "measurement": None,
                       "status": "unsourced"},
            "b_mV": {"what": "step added to the adaptation term by one spike of that cell",
                     "measurement": None, "status": "unsourced"},
        },
        # Filled in only from a paper that was opened and whose number was read in its own text. Until then
        # it stays None and every output says the constants were scanned, not measured.
        "measurement": None,
        "status": "unsourced",
        "why_it_is_a_deviation_and_not_a_correction": (
            "A correction replaces a predicted value with a measured one and changes nothing else. This adds "
            "a mechanism, and the published model's authors did not omit adaptation by oversight: a plain "
            "LIF is the model they validated. Adding adaptation makes the network something other than the "
            "model in the paper, whatever the constants are, so no result from a run with it switched on may "
            "be presented as a property of the published model."),
        "how_it_must_be_reported": (
            "Wherever a number from an adapted run appears, the deviation is named alongside it, and while "
            "the constants are unsourced the range scanned is given rather than a single value. A scan that "
            "is reported as a scan is not an invented parameter; a single chosen value with no citation "
            "would be."),
    },
}


# What sleep actually looks like in a fly brain, measured. This is the target any claimed episode has to be
# compared against, and it is here so that a comparison cannot be made up at the point of writing a figure
# caption. Nothing in this table is a model parameter; none of it is fitted to.
SLEEP_OBSERVABLES = {
    "r5_slow_wave": {
        "what": ("Network-generated slow-wave activity, up states and down states, in the R5 ellipsoid-body "
                 "ring neurons that carry the sleep homeostat. About 10 cells per hemisphere."),
        "frequency_hz": [0.5, 1.5],
        "period_s": [0.67, 2.0],
        "period_is_derived": ("The paper prints the frequency band, not a period and not an episode duration. "
                              "0.67 to 2.0 s is 1/f of the printed band and is arithmetic, not a measurement."),
        "up_down_amplitude_mV": "about 26 +/- 7",
        "sleep_dependence": ("Frequency is unchanged by sleep deprivation; up and down state POWER increases "
                             "significantly with it."),
        "source": ("Raccuglia D, Huang S, Ender A, Heim MM, Laber D, Suarez-Grimalt R, Liotta A, Sigrist SJ, "
                   "Geiger JRP, Owald D (2019) Current Biology 29:3611-3621.e3, "
                   "DOI 10.1016/j.cub.2019.08.070, PMID 31630950. In vivo, with simultaneous patch clamp."),
    },
    "apl_sk_ahp": {
        "what": ("Slow afterhyperpolarisation in APL, the mushroom body's feedback inhibitory neuron, carried "
                 "by SK channels. Sleep deprivation enhances it; recovery sleep reduces it."),
        "decay_tau_ms": 491.1,
        "decay_tau_sem_ms": 72.17,
        "amplitude": ("NOT REPORTED. No mV and no nS value for the APL afterhyperpolarisation appears anywhere "
                      "in the paper's text; the amplitude panels give only n. So this measurement fixes a "
                      "timescale and cannot fix a magnitude."),
        "condition": ("The 491.1 ms fit is from the SLEEP-DEPRIVED condition only. The authors state that "
                      "exponential fitting was unreliable in the normally-slept group, so there is no measured "
                      "baseline time constant to compare it with."),
        "also_confirms": ("APL is non-spiking and responds to somatic current injection in a graded way, which "
                          "is the correction this project already applies to APL from Amin et al. 2020."),
        "source": ("Chen CC, Huang YC, Ortega A, Suarez-Grimalt R, Tedre E, Baz ES, Wu Y, Lin AC, Liu S (2026) "
                   "'Sleep facilitates pattern separation through SK channel-mediated sparse coding', "
                   "Current Biology 36:1633-1643.e6, DOI 10.1016/j.cub.2026.02.028, PMID 41844155, "
                   "PMC13075853. Adult ex vivo brain, whole-cell current clamp."),
    },
}
