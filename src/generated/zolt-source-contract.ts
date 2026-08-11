// Source-level contract canary. The production release pin now points to this
// exact reviewed commit, while publication remains separately gated on live
// repository canaries and explicit Action wiring.
export const ZOLT_EXACT_TARGET_CONTRACT_COMMIT =
    'ae6532ef804c6347c6b1e72742216b9443c6c288';
