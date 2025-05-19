export default {
    preset: "ts-jest",
    setupFilesAfterEnv: ["./jest-setup.ts"],
    testEnvironment: "node",
    extensionsToTreatAsEsm: [".ts"],
    transform: {
        "^.+\\.ts$": ["ts-jest", { useESM: true }],
    }
};
