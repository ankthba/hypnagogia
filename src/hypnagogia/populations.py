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
