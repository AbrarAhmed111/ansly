# Ansly — Universal Resume Tailoring, JSON Profile Import, Persistent Memory, and Context-Aware Answers

Inspect the existing Ansly codebase and implement all the improvements below end to end. The solution must work for different users, resume formats, professions, skill sets, and job types—not just one user's resume or technology stack.

Do not hardcode my personal resume, profile structure, or skills as the universal solution. Adapt to each user's actual information and the existing application architecture.

## Part 1: Fix Universal Resume-Tailoring Accuracy

### 1. Investigate the root cause

Trace the complete resume-tailoring pipeline, including:

- Resume parsing and profile extraction.
- Job-description analysis.
- Skill matching and prioritization.
- Skill categorization.
- LLM prompts and response processing.
- Final resume generation and validation.

Identify why skills can end up under incorrect categories. Check for hardcoded resume structures, predefined skill lists, category assumptions, prompt problems, and overreliance on LLM-generated output.

Implement a general solution rather than adding one-off patches for individual skills.

### 2. Support different resume structures and professions

Users may have different resume formats, section headings, industries, and professional backgrounds.

Requirements:

- Preserve the user's original resume structure and headings wherever practical.
- Support technical and non-technical professions.
- Support custom categories when predefined categories are insufficient.
- Handle resumes without a dedicated skills section.
- Do not force every user into a software-engineering resume template.
- Adapt the tailoring process to each user's actual profile and target role.

### 3. Separate skill selection from skill categorization

The tailoring pipeline should:

1. Extract skills and experience supported by the user's resume and profile.
2. Analyze the target job description.
3. Match job requirements against the candidate's existing evidence.
4. Select and prioritize relevant, supported skills.
5. Categorize skills according to their actual meaning and professional context.
6. Generate the tailored resume.
7. Validate the final output.

Examples:

- SQL and NoSQL belong in database-related categories.
- Docker belongs in containerization, DevOps, or infrastructure-related categories.
- LangChain and RAG belong in AI/LLM-related categories.
- Financial modeling belongs in finance-related categories.
- Figma belongs in design-related categories.

These are illustrative examples, not an exhaustive list or a fixed taxonomy.

The job description may influence skill relevance and ordering, but must not arbitrarily determine skill categories. If a skill spans multiple domains, assign it an appropriate primary category and avoid unnecessary duplication.

### 4. Preserve factual accuracy

- Never invent skills, qualifications, projects, employers, responsibilities, or achievements.
- Never treat a skill mentioned in a job description as proof that the candidate possesses it.
- Never exaggerate proficiency or experience.
- Preserve the meaning of the original resume.
- Handle ambiguous information conservatively.
- Keep claims grounded in the user's resume, profile, or other verified information.

### 5. Validate the final resume

Use deterministic validation for clear rules and AI-based classification where contextual reasoning is necessary.

Validate that:

- Skills are placed in appropriate categories.
- Unrelated categories have not been mixed together.
- Relevant original information has been preserved.
- Unsupported skills or achievements have not been introduced.
- The user's resume structure is respected.
- The final document remains suitable for ATS parsing.

If validation fails, correct the affected output or safely regenerate it instead of silently returning a corrupted resume.

### 6. Add regression tests

Include tests for:

- A software engineer applying for an AI role where SQL, NoSQL, and Docker must remain correctly categorized.
- Different resume structures and custom headings.
- Candidates from non-technical professions.
- Resumes without an explicit skills section.
- Unfamiliar skills and custom categories.
- Job descriptions containing skills the candidate does not possess.
- Ambiguous skills and overlapping domains.
- Preservation of original sections and factual accuracy.

Tests must verify the final generated resume, not merely whether the LLM returns valid JSON.

---

## Part 2: Improve New-User JSON Profile Import

### 1. Add a paste-or-type JSON editor

During signup or initial profile setup, users should be able to import profile information using either:

- **Upload JSON file:** Preserve existing functionality.
- **Paste or enter JSON:** Add a multiline editor where users can type or paste their profile JSON directly.

Both methods must use the same parsing, validation, preview, and database-import pipeline.

Use the project's existing UI components and conventions. Reuse a suitable code editor if one already exists; otherwise, implement a lightweight, accessible editor with readable indentation and helpful error feedback.

### 2. Explain the supported JSON format

Add a clearly accessible section such as **"View JSON format"** or **"Example JSON"** near the editor.

Explain:

- Supported and required fields.
- Expected data types for each field.
- Optional fields.
- Supported nested objects and arrays.
- Rules for empty, missing, and null values.
- Handling of unknown fields.
- Date formats and field-specific validation requirements.

Generate this guidance from the actual profile schema and validation rules wherever possible. Do not invent a schema based on assumptions.

Provide a complete, valid example JSON object users can copy and customize.

### 3. Support JSON data types appropriately

Support the types permitted by the actual profile schema:

- Strings, such as `"name": "Alex"`.
- Numbers, such as `"yearsExperience": 4`.
- Booleans, such as `"activelyLooking": true`.
- Arrays of strings, such as `"skills": ["React", "PostgreSQL"]`.
- Nested objects, such as `"contact": {"email": "alex@example.com"}`.
- Arrays of objects, where supported by the schema.
- Null values only for fields where null is permitted.

Explain that JSON does not support `undefined`, comments, trailing commas, or native date objects. Dates must follow the existing schema's expected format, typically ISO 8601 strings where applicable.

These examples illustrate JSON types; they do not require every user's profile to contain these exact fields.

### 4. Validate before saving

The import process should:

1. Parse the JSON and detect syntax errors.
2. Validate the structure against the actual profile schema.
3. Check required fields, data types, nested structures, arrays, and constraints.
4. Display clear errors with the relevant field or JSON path.
5. Preserve entered content when validation fails.
6. Preview the validated profile before saving, where appropriate.
7. Save using the existing database layer and server-side validation.

Do not silently coerce invalid values or discard important fields without informing the user.

### 5. Protect profile data

- Use existing authentication and authorization.
- Only allow users to modify fields they are authorized to change.
- Prevent imports from overwriting system-controlled fields such as user IDs, roles, permissions, or ownership.
- Validate on the server as well as the client.
- Handle oversized input and unexpected nested structures safely.
- Never execute imported JSON as code.
- Prevent accidental overwrites of existing profile information.
- Explain whether importing merges with or replaces existing data.

### 6. Preserve compatibility

Imported profile information must be available to the existing:

- Resume-tailoring pipeline.
- Job application question-answering pipeline.
- Profile-grounded answer generation.
- Persistent memory feature described in Part 3.

Do not require every user to have the same profile fields or resume structure.

### 7. Add import tests

Test valid pasted JSON, valid uploaded JSON, malformed JSON, missing required fields, incorrect data types, invalid nested objects and array elements, optional and nullable fields, unknown fields, empty and oversized input, protected-field modification attempts, database errors, duplicate submissions, content preservation after errors, and successful import followed by profile retrieval and resume tailoring.

---

## Part 3: Add "Answer and Save to Memory" to the Browser Extension

### 1. Allow users to provide or correct answers

When Ansly generates an answer to a job application question in the browser extension:

- Display the generated answer in an editable field.
- Let the user modify it or write their own answer from scratch.
- Add a **"Save to Memory"** button near the answer.
- Keep saving memory separate from filling the application form.
- Preserve the existing review, edit, and fill-on-approval workflow.

Users must be able to provide and save an answer even when Ansly initially has no relevant context.

### 2. Save reusable context

When the user explicitly clicks **"Save to Memory"**, save the question, the user's final answer, and relevant metadata using the existing profile and database architecture.

**Example A — Salary expectations**

Question: "What are your salary expectations?"

User answer: "We will discuss this in the meeting."

Ansly should remember that the user prefers this response for salary-expectation questions. It should use this preference in relevant future applications instead of inventing a salary range.

**Example B — Motivation for programming**

Question: "Why did you start programming?"

User answer: "I started because I love programming."

Ansly should recognize this as personal context about the user's motivation. It may use this information naturally when answering future questions about career motivation, interest in software development, or reasons for choosing programming.

It must not force this context into unrelated answers.

### 3. Distinguish memory types

Support flexible categories such as:

- **Answer preference:** A response the user prefers for a question or topic.
- **Personal context:** User-provided motivations, interests, and experiences.
- **Professional context:** Skills, career goals, work preferences, and professional experience.
- **Other context:** Useful information that does not fit existing categories.

Use the existing data model where possible and extend it only as needed. Do not hardcode the system to the example questions.

Infer the likely memory type from the question and answer, but allow users to review what will be saved. Preserve the original question and answer so the memory retains its meaning.

For example, "We will discuss this in the meeting" is primarily an answer preference for salary questions, while "I started because I love programming" is personal context.

### 4. Retrieve relevant memories for future answers

Integrate saved memories into the existing answer-generation pipeline.

The process should:

1. Receive a new application question.
2. Retrieve relevant profile information and saved memories.
3. Identify applicable answer preferences, personal context, and professional facts.
4. Generate an answer using the relevant context.
5. Respect the user's preferences and factual information.
6. Allow the user to review and edit the answer before filling the form.

Use relevance-based retrieval rather than injecting every saved memory into every prompt.

Prioritize a saved preference when it directly matches the new question. Reuse personal context when it is relevant to differently worded questions. Do not blindly copy the original answer into every response.

If context is insufficient, do not fabricate facts. Ask the user or follow the application's existing cautious-answer behavior.

### 5. Give users control over memory

After the user clicks "Save to Memory":

- Confirm success only after the database confirms persistence.
- Display useful error feedback if saving fails.
- Prevent duplicate entries where practical.
- Allow users to view, edit, and delete saved memories through an existing or newly implemented memory-management interface.
- Allow users to update an existing preference without accidentally creating conflicting entries.
- Clearly show which answer or context will be saved.

Saving must require an explicit user action. Generating, editing, or filling an answer must not silently create persistent memory.

### 6. Handle conflicting and outdated memories

Support cases where users change a preference, correct a professional detail, provide contradictory answers, or replace outdated information.

Update a related memory rather than accumulating conflicting records indefinitely. Do not automatically overwrite unrelated memories merely because their topics are similar.

If the system cannot confidently determine whether a new answer replaces an existing memory, let the user decide.

### 7. Protect memory data

- Associate each memory with the correct authenticated user.
- Enforce server-side authorization for reading, creating, updating, and deleting memories.
- Prevent cross-user memory access.
- Validate stored data.
- Reuse existing database and API patterns.
- Avoid storing sensitive information unnecessarily.
- Do not infer personal facts that the user did not provide.
- Ensure memory retrieval accesses only the current user's authorized context.

### 8. Add memory tests

Test saving new answers, saving revised answers, retrieving memories for semantically similar questions, reusing preferences appropriately, reusing personal context, avoiding irrelevant memory injection, updating preferences without conflicting duplicates, handling outdated memories, failed database writes, user isolation, explicit-consent requirements, and verifying that saved memories actually affect subsequent answer generation.

---

## Part 4: Make Ansly's Answer Generation Context-Aware

### Problem

Currently, Ansly appears to reuse saved answers mainly when a new question closely matches the original question's wording. This limits its usefulness.

Ansly should understand the meaning and intent of a question and use relevant information from the user's profile, resume, projects, work experience, and saved context to generate a personalized answer—even when the wording differs or the question asks about related experiences.

**The objective is not simply to retrieve an old answer. It is to retrieve relevant evidence and use it to generate a better answer for the new question.**

### 1. Build unified context retrieval

Before generating an answer, retrieve relevant information from all available sources:

- **Saved memories:** User-approved facts, preferences, motivations, and previous answers.
- **Resume content:** Work experience, responsibilities, achievements, education, and skills.
- **Profile data:** Career goals, preferred roles, experience level, work preferences, and other supplied information.
- **Project information:** Project descriptions, technologies, responsibilities, implementation details, and supported accomplishments.
- **Previous answers:** Relevant user-provided or user-approved answers, including their underlying factual context and preferences.
- **Current workflow context:** Relevant information available from the current conversation or application session.

Use only sources that actually exist and are accessible to the current user. Do not assume every user has every type of information.

Avoid maintaining separate, disconnected versions of the user's profile and memory when the existing architecture can provide a unified retrieval layer.

### 2. Retrieve by meaning, not exact wording

Replace or improve exact-question matching as the primary retrieval mechanism.

The system should identify the intent behind a question and retrieve relevant information even when the wording differs.

For example, if the user previously saved:

Question: "Why did you start programming?"

Answer: "I started because I love programming."

Ansly should recognize that this information may also help answer:

- "What attracted you to software development?"
- "Why did you choose a career in technology?"
- "What motivates you as a developer?"
- "Why are you passionate about programming?"

Generate a response appropriate to each question rather than requiring an exact match or blindly repeating the original answer.

These questions are not necessarily interchangeable. Use the context only when it genuinely helps answer the new question.

### 3. Combine multiple relevant sources

Do not generate answers from memory alone. Combine the most relevant information from the resume, projects, work experience, profile, saved memories, and previous user-confirmed answers.

**Example**

A user's profile contains:

- Resume: Full Stack Engineer with Next.js and PostgreSQL experience.
- Project: OnTask, a work execution and collaboration platform.
- Project details: Designed database schemas and implemented backend logic.
- Saved personal context: "I enjoy solving practical problems through programming."

Question: "Tell us about a project where you solved a challenging technical problem."

Ansly should retrieve the relevant project details and generate a coherent, evidence-based answer.

It may include the user's motivation if relevant, but must not invent a specific challenge, outcome, metric, or achievement that is not supported by the available information.

If the profile lacks details about the actual challenge, ask the user for more information or generate a cautious answer from the verified facts available.

### 4. Separate facts from preferences and inferences

Distinguish between:

- **Factual evidence:** What the user did, built, learned, achieved, or experienced.
- **Personal context:** Motivations, interests, values, and career goals.
- **Answer preferences:** Responses the user prefers for specific topics.
- **Context-specific instructions:** Preferences that apply only to a particular application, employer, or question.
- **Unverified inference:** Information suggested by the model but not confirmed by the user.

Use factual evidence to answer experience questions, personal context to personalize motivation questions, and answer preferences for matching topics.

A previously generated answer must not automatically become a verified fact merely because Ansly generated it. Use it as factual evidence only when supported by the user's profile or confirmed by the user.

### 5. Implement relevance-based context assembly

Before generating a response:

1. Understand the question's intent and expected answer type.
2. Extract its key concepts and requirements.
3. Search the user's accessible profile, resume, projects, experience, saved memories, and relevant previous answers.
4. Rank retrieved information by semantic relevance, factual reliability, specificity, and recency where appropriate.
5. Resolve conflicts conservatively.
6. Assemble a concise context containing only useful information.
7. Generate an answer that directly addresses the question.
8. Validate factual claims against retrieved evidence.
9. Return the answer through the existing review, edit, and fill workflow.

Use the existing architecture and technologies wherever practical. If current retrieval relies only on exact string matching, improve it with semantic matching and structured retrieval.

Embeddings or a vector database may be appropriate if the existing system cannot reliably find relevant context, but evaluate the current architecture, data volume, cost, latency, and maintenance burden before adding infrastructure. For small profiles, structured filtering and semantic similarity may be sufficient.

### 6. Generate better answers, not just retrieve text

Generated answers should:

- Directly address the current question.
- Use specific evidence from the user's actual experience.
- Combine related information when it improves the answer.
- Avoid irrelevant details and unnecessary repetition.
- Adapt tone, length, and structure to the question and application.
- Sound natural rather than like copied profile fields.
- Preserve factual meaning and stated preferences.
- Avoid repeating the same project or introduction in every answer unless relevant.

### 7. Handle missing information intelligently

When relevant context is unavailable:

- Do not invent experience, accomplishments, motivations, or qualifications.
- Use related verified evidence only when it genuinely supports the answer.
- Ask the user for additional information when it is essential.
- If the workflow requires an immediate answer, provide a cautious response based on supported facts.

When the user supplies new information and explicitly saves it to memory, make it available for relevant future answers.

### 8. Resolve conflicting sources

When information from the resume, profile, memories, and previous answers conflicts:

- Prefer explicit, recent user corrections over older information.
- Treat user-confirmed facts as stronger evidence than AI-generated inferences.
- Do not silently combine contradictory dates, roles, skills, or achievements.
- Ask for clarification when a material contradiction cannot be resolved.
- Keep answer preferences separate from factual claims.

### 9. Test context retrieval and generation

Include tests for:

- Exact repeats of previously answered questions.
- Semantically equivalent questions with different wording.
- Motivation questions answered using saved personal context.
- Project questions answered using resume and project details together.
- Experience questions combining multiple relevant, verified facts.
- Questions that should use a saved answer preference.
- Questions where a saved memory is irrelevant and must not be included.
- Missing context that requires clarification.
- Conflicting resume and memory information.
- AI-generated previous answers containing unsupported information.
- Different professions, profile structures, and amounts of stored data.
- Users with no saved memories but useful resume or project information.

Evaluate both retrieval quality and final answer quality. A successful response must be relevant, grounded, and accurate—not merely technically successful.

---

## Part 5: Integration, Security, Testing, and Delivery

### 1. Inspect the existing architecture first

Before coding, inspect:

- Repository structure and conventions.
- Browser extension UI and question-answering flow.
- Profile schema and database models.
- JSON import and onboarding components.
- Resume parsing and tailoring services.
- LLM prompts, provider integrations, and validation.
- Authentication, API authorization, and persistence.
- Memory retrieval and answer-generation services.
- Existing tests and CI checks.

Identify the root causes and provide a concise implementation plan before making changes.

### 2. Integrate all features

All four improvements must work together:

- JSON-imported information must become available to profile retrieval and answer generation.
- Saved memories must persist across sessions and be available to future relevant questions.
- Resume tailoring must use supported profile evidence without inventing qualifications.
- Context-aware answer generation must use relevant information from the user's resume, projects, experience, profile, and memories.
- Memory retrieval must use the same user's authorized information and respect user preferences.
- Existing browser-extension review/edit/fill behavior must remain functional.

Do not create disconnected profile systems, duplicate memory databases, or parallel import pipelines if the existing architecture can be extended safely.

### 3. Preserve existing functionality

- Keep existing JSON file uploads working.
- Avoid unnecessary redesigns of onboarding or the extension.
- Preserve existing authentication and authorization.
- Maintain compatibility with saved resumes and existing profile records.
- Keep the UI accessible and responsive.
- Follow existing coding, logging, error-handling, and security conventions.
- Avoid unrelated refactoring.

### 4. Implement and verify

Complete the work rather than returning recommendations or pseudocode.

1. Identify the root causes.
2. Implement the fixes.
3. Add database migrations or schema changes only where necessary.
4. Add automated tests for all corrected and new behavior.
5. Run relevant tests, linting, type checks, and build commands.
6. Fix regressions caused by the changes.
7. Review security, authorization, backward compatibility, and error handling.

At completion, report:

- Root causes identified.
- Features implemented.
- Files changed.
- Database or migration changes.
- Tests and checks executed, with their actual results.
- Any remaining limitations or work that could not be completed.

## Final Principles

Ansly must:

- Adapt to each user's actual resume, profile, profession, and skills.
- Categorize skills correctly and preserve factual accuracy.
- Allow users to import profile information using either a JSON file or pasted JSON.
- Learn additional context only through explicit user-approved memory actions.
- Reuse relevant memories across semantically related questions.
- Combine resume evidence, projects, work experience, profile information, and confirmed answers to generate better responses.
- Avoid hallucinating qualifications, inventing achievements, or forcing irrelevant context into answers.
- Protect user data and preserve user control over saved information.

**Success means that Ansly understands the candidate's background and uses it intelligently to answer new questions—not that it simply finds an old answer when the wording matches.**