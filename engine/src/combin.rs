//! Combinatorics helpers: binomial coefficients, colexicographic subset
//! indices, and combination enumeration.

/// Largest deck size supported by the precomputed binomial table.
pub const MAX_DECK: usize = 64;

/// `BINOM[n][k]` = C(n, k) for n ≤ 64, k ≤ 6.
pub const BINOM: [[u64; 7]; MAX_DECK + 1] = build_binom();

const fn build_binom() -> [[u64; 7]; MAX_DECK + 1] {
    let mut t = [[0u64; 7]; MAX_DECK + 1];
    let mut n = 0;
    while n <= MAX_DECK {
        t[n][0] = 1;
        let mut k = 1;
        while k < 7 {
            if n > 0 {
                t[n][k] = t[n - 1][k - 1] + t[n - 1][k];
            }
            k += 1;
        }
        n += 1;
    }
    t
}

#[inline]
pub fn choose(n: usize, k: usize) -> u64 {
    BINOM[n][k]
}

/// Colex index of a strictly ascending set of card ids: Σ C(c_i, i+1).
/// Maps the k-subsets of {0..n} bijectively onto 0..C(n,k).
#[inline]
pub fn colex_index(sorted: &[u8]) -> usize {
    let mut idx = 0u64;
    for (i, &c) in sorted.iter().enumerate() {
        idx += BINOM[c as usize][i + 1];
    }
    idx as usize
}

/// Calls `f` with every k-subset of `items` (in lexicographic order of
/// positions). The slice passed to `f` preserves the order of `items`.
pub fn for_each_combination<F: FnMut(&[u8])>(items: &[u8], k: usize, mut f: F) {
    let n = items.len();
    if k > n {
        return;
    }
    let mut pos: Vec<usize> = (0..k).collect();
    let mut buf: Vec<u8> = pos.iter().map(|&p| items[p]).collect();
    loop {
        f(&buf);
        // Advance: find the rightmost position that can still move right.
        let mut i = k;
        while i > 0 && pos[i - 1] == i - 1 + n - k {
            i -= 1;
        }
        if i == 0 {
            return;
        }
        let i = i - 1;
        pos[i] += 1;
        buf[i] = items[pos[i]];
        for j in i + 1..k {
            pos[j] = pos[j - 1] + 1;
            buf[j] = items[pos[j]];
        }
    }
}

pub fn gcd_i128(mut a: i128, mut b: i128) -> i128 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

pub fn lcm_i128(a: i128, b: i128) -> i128 {
    if a == 0 || b == 0 {
        return 0;
    }
    (a / gcd_i128(a, b)) * b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binomials() {
        assert_eq!(choose(52, 5), 2_598_960);
        assert_eq!(choose(47, 5), 1_533_939);
        assert_eq!(choose(47, 0), 1);
        assert_eq!(choose(3, 5), 0);
    }

    #[test]
    fn colex_is_a_bijection() {
        let items: Vec<u8> = (0..12).collect();
        for k in 0..=5 {
            let mut seen = vec![false; choose(12, k) as usize];
            for_each_combination(&items, k, |c| {
                let i = colex_index(c);
                assert!(!seen[i], "duplicate index");
                seen[i] = true;
            });
            assert!(seen.iter().all(|&s| s), "k={k} not onto");
        }
    }

    #[test]
    fn combination_counts() {
        let items: Vec<u8> = (0..10).collect();
        for k in 0..=6 {
            let mut n = 0;
            for_each_combination(&items, k, |_| n += 1);
            assert_eq!(n, choose(10, k));
        }
        let mut n = 0;
        for_each_combination(&items[..3], 5, |_| n += 1);
        assert_eq!(n, 0);
    }
}
