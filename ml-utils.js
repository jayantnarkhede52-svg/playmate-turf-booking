/**
 * Machine Learning Utilities for PlayMate
 * Focuses on Vector Space Modeling and Similarity Scoring
 */

const ML_UTILS = {
    /**
     * Normalizes a value between 0 and 1
     */
    normalize: (val, min, max) => (val - min) / (max - min),

    /**
     * Calculates Weighted Cosine Similarity between two vectors
     * @param {Array} v1 - User vector
     * @param {Array} v2 - Candidate vector
     * @param {Array} weights - Importance of each feature
     */
    cosineSimilarity: (v1, v2, weights) => {
        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;

        for (let i = 0; i < v1.length; i++) {
            const w = weights[i] || 1;
            dotProduct += (v1[i] * v2[i] * w);
            mag1 += (v1[i] * v1[i] * w);
            mag2 += (v2[i] * v2[i] * w);
        }

        const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
        return mag === 0 ? 0 : dotProduct / mag;
    },

    /**
     * Encodes categorical data into numerical values
     */
    encodePosition: (pos) => {
        const positions = {
            'Forward': 1.0,
            'Midfielder': 0.7,
            'Defender': 0.3,
            'Goalkeeper': 0.1,
            'Any': 0.5
        };
        return positions[pos] || 0.5;
    },

    /**
     * Factors in zone similarity
     */
    zoneMatchScore: (z1, z2) => {
        return z1 === z2 ? 1.0 : 0.2;
    },

    /**
     * Calculates Mutual Connection Score (Collaborative Filtering)
     * @param {Array} userConns - List of IDs the current user is connected to
     * @param {Array} targetConns - List of IDs the target user is connected to
     */
    mutualConnectionScore: (userConns, targetConns) => {
        if (!userConns.length || !targetConns.length) return 0;
        const set1 = new Set(userConns);
        const mutual = targetConns.filter(id => set1.has(id));
        // Normalize: More than 3 mutual friends is a strong signal
        return Math.min(1.0, mutual.length / 3);
    },

    /**
     * Activity Boost for responsive players
     * @param {number} connectionCount - Total successful connections
     */
    activityHeatBoost: (connectionCount) => {
        // Boost players who have at least 5 connections (active users)
        return connectionCount >= 5 ? 1.2 : 1.0;
    }
};

module.exports = ML_UTILS;
