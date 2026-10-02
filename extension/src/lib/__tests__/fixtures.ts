/**
 * Simplified copies of real application form markup. They keep the parts that
 * matter for detection: how labels relate to fields, and the field types.
 */

export const GREENHOUSE = `
<title>Job Application for Senior Software Engineer at Acme</title>
<form id="application-form">
  <div class="field-wrapper"><label id="first_name-label" for="first_name">First Name<span aria-hidden="true">*</span></label><input id="first_name" type="text" autocomplete="given-name"></div>
  <div class="field-wrapper"><label for="last_name">Last Name*</label><input id="last_name" type="text"></div>
  <div class="field-wrapper"><label for="email">Email*</label><input id="email" type="text"></div>
  <div class="field-wrapper"><label for="phone">Phone</label><input id="phone" type="tel"></div>
  <div class="field-wrapper"><label for="question_1">LinkedIn Profile</label><input id="question_1" type="text"></div>
  <div class="field-wrapper"><label for="question_2">Website</label><input id="question_2" type="text"></div>
  <div class="field-wrapper"><label for="question_3">Why do you want to work at Acme?*</label><textarea id="question_3"></textarea></div>
  <div class="field-wrapper"><label for="question_4">How did you hear about this job?</label><input id="question_4" type="text"></div>
  <div class="field-wrapper"><label for="question_5">Are you legally authorized to work in the United States?</label><select id="question_5"><option>Yes</option><option>No</option></select></div>
  <div class="field-wrapper"><label for="question_6">Tell us about a technically challenging project you worked on.</label><textarea id="question_6"></textarea></div>
  <div class="field-wrapper"><label for="question_7">Cover Letter</label><textarea id="question_7"></textarea></div>
</form>`

export const LEVER = `
<title>Acme - Senior Product Engineer</title>
<form>
  <ul>
    <li class="application-question"><label><div class="application-label">Full name<span class="required">✱</span></div><div class="application-field"><input type="text" name="name"></div></label></li>
    <li class="application-question"><label><div class="application-label">Email<span class="required">✱</span></div><div class="application-field"><input type="email" name="email"></div></label></li>
    <li class="application-question"><label><div class="application-label">Current company</div><div class="application-field"><input type="text" name="org"></div></label></li>
    <li class="application-question"><label><div class="application-label">LinkedIn URL</div><div class="application-field"><input type="text" name="urls[LinkedIn]"></div></label></li>
  </ul>
  <div class="application-question custom-question">
    <div class="application-label full-width"><div class="text">What excites you about Acme?<span class="required">✱</span></div></div>
    <div class="application-field full-width"><textarea name="cards[abc][field0]"></textarea></div>
  </div>
  <div class="application-additional">
    <textarea name="comments" placeholder="Add a cover letter or anything else you want to share."></textarea>
  </div>
</form>`

export const LINKEDIN = `
<title>(3) Senior Frontend Engineer | Acme | LinkedIn</title>
<div role="dialog" aria-labelledby="jobs-apply-header">
  <h2 id="jobs-apply-header">Apply to Acme</h2>
  <form>
    <div class="fb-dash-form-element"><label for="single-line-text-form-component-1">How many years of work experience do you have with React.js?</label><input id="single-line-text-form-component-1" type="text"></div>
    <div class="fb-dash-form-element"><label for="phone">Mobile phone number</label><input id="phone" type="text"></div>
    <div class="fb-dash-form-element"><label for="multiline-1"><span>Why are you interested in this role?</span></label><textarea id="multiline-1"></textarea></div>
    <div class="fb-dash-form-element"><label for="single-2">Briefly describe your experience leading a team</label><input id="single-2" type="text"></div>
    <fieldset><legend><span>Are you comfortable commuting to this job's location?</span></legend>
      <input type="radio" name="commute" value="Yes"><input type="radio" name="commute" value="No">
    </fieldset>
  </form>
</div>`

export const INDEED = `
<title>Software Engineer - Acme - Indeed.com</title>
<div class="ia-Questions">
  <div class="ia-Questions-item"><label id="q_0-label" for="q_0"><span>What is your desired salary?</span></label><input id="q_0" type="text"></div>
  <div class="ia-Questions-item"><div id="q_1-label"><span>Describe your experience with Python.</span></div><textarea id="q_1" aria-labelledby="q_1-label"></textarea></div>
  <div class="ia-Questions-item"><label for="q_2">City, State</label><input id="q_2" type="text"></div>
  <div class="ia-Questions-item"><label for="q_3">Do you have experience with Kubernetes?</label><input id="q_3" type="text"></div>
</div>`

export const WORKDAY = `
<div data-automation-id="formField-why"><label for="input-12">Please describe why you are interested in this position<abbr title="required">*</abbr></label><textarea id="input-12" data-automation-id="textAreaField"></textarea></div>
<div data-automation-id="formField-addressLine1"><label for="input-13">Address Line 1</label><input id="input-13" type="text"></div>
<div data-automation-id="formField-dob"><label for="input-14">Date of Birth</label><input id="input-14" type="date"></div>`

export const RICH_EDITOR = `
<div class="question"><div class="label">Tell us about yourself</div>
  <div class="ql-editor" contenteditable="true"><p><br></p><div contenteditable="true">nested</div></div>
</div>`

export const NOISE = `
<header><input type="search" placeholder="Search jobs"><input type="text" name="q" aria-label="Search"></header>
<div style="display:none"><label for="hidden-q">Why us?</label><textarea id="hidden-q"></textarea></div>
<label for="disabled-q">Why us?</label><textarea id="disabled-q" disabled></textarea>
<label for="ro-q">Why us?</label><textarea id="ro-q" readonly></textarea>
<input type="password" aria-label="Password"><input type="number" aria-label="Years"><input type="hidden" name="token">`

// Greenhouse's newer job-boards UI: react-select comboboxes, EEO selects, a consent checkbox.
export const GREENHOUSE_NEW = `
<title>Senior Engineer at Acme | Greenhouse</title>
<form>
  <div class="text-input-wrapper"><label id="first_name-label" for="first_name">First Name<span>*</span></label><input id="first_name" aria-required="true" type="text"></div>
  <div class="field-wrapper"><label id="question_100-label" for="question_100">Will you now or in the future require sponsorship?<span>*</span></label>
    <div class="select__container"><div class="select__control"><input id="question_100" role="combobox" aria-expanded="false" aria-labelledby="question_100-label" aria-required="true" type="text" value=""></div></div>
  </div>
  <div class="field-wrapper"><label for="question_101">Years of experience with TypeScript</label><input id="question_101" type="number"></div>
  <div class="field-wrapper"><label for="question_102">What is your notice period?</label><input id="question_102" type="text"></div>
  <fieldset><legend>Which of these have you used in production?</legend>
    <label><input type="checkbox" name="question_103[]" value="react"> React</label>
    <label><input type="checkbox" name="question_103[]" value="vue"> Vue</label>
    <label><input type="checkbox" name="question_103[]" value="python"> Python</label>
  </fieldset>
  <div class="eeoc"><label for="gender">Gender</label><select id="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></div>
  <div class="eeoc"><label for="veteran_status">Veteran Status</label><select id="veteran_status"><option value="">Select...</option><option>I am a veteran</option></select></div>
  <label><input type="checkbox" name="gdpr_consent"> I agree to the privacy policy</label>
  <div class="field-wrapper"><label for="resume">Resume/CV</label><input id="resume" type="file"></div>
</form>`

// Ashby: radio-like buttons, a yes/no checkbox, an essay.
export const ASHBY = `
<title>Product Engineer @ Acme</title>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_name">Name</label><input id="_systemfield_name" type="text"></div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="a1">Are you willing to relocate to San Francisco?</label>
  <div role="radiogroup" aria-labelledby="a1-label"><span id="a1-label" hidden>Are you willing to relocate to San Francisco?</span>
    <div role="radio" aria-checked="false" tabindex="0">Yes</div><div role="radio" aria-checked="false" tabindex="-1">No</div>
  </div>
</div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="a2">What would you build in your first 90 days?</label><textarea id="a2"></textarea></div>
<div class="ashby-application-form-field-entry"><label><input type="checkbox" name="remote_ok"> I'm comfortable working in a hybrid setup</label></div>`

// Workday: labels via data-automation-id, a radio group, an ARIA listbox dropdown.
export const WORKDAY_WIDGETS = `
<div data-automation-id="formField-legallyAuthorized">
  <div data-automation-id="formLabel">Are you legally authorized to work in this country?</div>
  <div><input type="radio" id="r1" name="auth" value="1"><label for="r1">Yes</label><input type="radio" id="r2" name="auth" value="0"><label for="r2">No</label></div>
</div>
<div data-automation-id="formField-howDidYouHear">
  <div data-automation-id="formLabel">How did you hear about us?</div>
  <button aria-haspopup="listbox" data-automation-id="dropdown">Select One</button>
  <div role="listbox" aria-label="How did you hear about us?"><div role="option">LinkedIn</div><div role="option">Referral</div></div>
</div>
<div data-automation-id="formField-summary"><div data-automation-id="formLabel">Tell us about yourself</div><div><textarea data-automation-id="textAreaField"></textarea></div></div>`

// LinkedIn Easy Apply step 2: selects for logistics.
export const LINKEDIN_STEP = `
<div role="dialog"><form>
  <div><label for="sel-1"><span>Will you now, or in the future, require sponsorship for employment visa status?</span></label>
    <select id="sel-1" required><option value="Select an option">Select an option</option><option>Yes</option><option>No</option></select></div>
  <div><label for="sel-2"><span>Are you comfortable working in a hybrid setting?</span></label>
    <select id="sel-2"><option>Select an option</option><option>Yes</option><option>No</option></select></div>
  <div><label for="num-1">How many years of experience do you have with Python?</label><input id="num-1" type="text"></div>
</form></div>`
