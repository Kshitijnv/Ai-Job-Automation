const applicationConfig = require("../../config/application.json");
const semanticResolver = require("../lib/semantic-resolver");

console.log("Checking local Ollama model and chat API...");
semanticResolver.checkOllama({ applicationConfig }).then(result => {
  console.log(`Ollama reachable: ${result.reachable}`);
  console.log(`Model available: ${result.model}`);
  console.log(`Classification: ${JSON.stringify(result.classification)}`);
}).catch(error => {
  console.error(`Ollama connectivity check failed: ${error.message}`);
  process.exitCode = 1;
});