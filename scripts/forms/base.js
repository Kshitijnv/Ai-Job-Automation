const formMapper = require("../lib/form-mapper");
const { uploadResume } = require("../lib/uploader");
const { generateCompanyAnswer } = require("../lib/company-answer");

function createFormModule(portal) {
  return Object.freeze({
    portal,
    fillKnownFields(page, profile) {
      return formMapper.fillKnownFields(page, profile);
    },
    fillConfiguredFields(page, applicationConfig) {
      return formMapper.fillConfiguredFields(page, applicationConfig);
    },
    fillSemanticQuestions(page, sources) {
      return formMapper.fillSemanticQuestions(page, sources);
    },
    uploadResume(page, resumePath) {
      return uploadResume(page, resumePath);
    },
    generateCompanyAnswer(type, company, jobDescription) {
      return generateCompanyAnswer(type, company, jobDescription);
    },
    fillCompanyAnswers(page, company, jobDescription) {
      return formMapper.fillCompanyAnswers(page, company, jobDescription, generateCompanyAnswer);
    },
    fillReviewAnswers(page, reviewAnswers) {
      return formMapper.fillReviewAnswers(page, reviewAnswers);
    },
    collectHumanRequiredFields(page, resolvedCanonicalIds) {
      return formMapper.collectHumanRequiredFields(page, resolvedCanonicalIds);
    },
    collectSensitiveFields(page) {
      return formMapper.collectSensitiveFields(page);
    },
    collectFieldMetadata(page) {
      return formMapper.collectFieldMetadata(page);
    }
  });
}

module.exports = { createFormModule };
