"""
Benchmark data: a fictional, realistically sized candidate (profile rows and the
master resume parsed from the same CV), two job postings and the application
questions for each benchmark scenario. Sized like a real mid-career profile so
prompt sizes are representative; every name, company and number is made up.
"""

from typing import Any, Dict, List

USER_ID = "11111111-1111-1111-1111-111111111111"


def _exp(i, company, title, start, end, location, description, highlights, technologies):
    return {"id": f"e{i}", "company": company, "title": title, "start_date": start, "end_date": end,
            "is_current": end is None, "location": location, "description": description,
            "highlights": highlights, "technologies": technologies, "sort_order": i}


EXPERIENCES = [
    _exp(1, "Harborline Analytics", "Senior Software Engineer", "2023-02-01", None, "Remote",
         "Lead engineer on the customer analytics platform: a Next.js dashboard backed by Python services on AWS. "
         "Own the ingestion API, the reporting service and the team's on-call runbooks.",
         ["Designed a FastAPI ingestion service that handles 12,000 events per second",
          "Moved reporting queries from ad-hoc SQL to materialized views in PostgreSQL, cutting dashboard p95 from 4.1s to 900ms",
          "Built an LLM-powered report summarizer with retrieval over customer documents",
          "Mentor two junior engineers and run the weekly architecture review"],
         ["Python", "FastAPI", "PostgreSQL", "Next.js", "TypeScript", "AWS", "Docker", "Terraform", "OpenAI API"]),
    _exp(2, "Copperleaf Health", "Software Engineer", "2020-08-01", "2023-01-31", "Boston, MA",
         "Full-stack engineer on the patient scheduling product used by 140 clinics. Built React front ends and "
         "Node.js and Python back-end services; worked closely with product and clinical operations.",
         ["Rebuilt the appointment booking flow in React and TypeScript, raising completed bookings by 18%",
          "Built an HL7/FHIR integration service in Python for three hospital partners",
          "Introduced end-to-end tests with Playwright and cut release regressions by half",
          "Migrated background jobs from cron to a Redis-backed queue"],
         ["React", "TypeScript", "Node.js", "Python", "PostgreSQL", "Redis", "Playwright", "GCP"]),
    _exp(3, "Brightpath Commerce", "Frontend Developer", "2018-06-01", "2020-07-31", "Chicago, IL",
         "Front-end developer for a mid-size e-commerce platform serving 40 retail brands.",
         ["Built a shared React component library adopted by 6 product teams",
          "Improved Lighthouse performance score from 52 to 91 on product pages",
          "Implemented A/B testing hooks with the growth team"],
         ["React", "JavaScript", "Redux", "Sass", "Webpack", "Jest"]),
    _exp(4, "Northgate University IT", "Web Developer (Part-time)", "2016-09-01", "2018-05-31", "Northgate, IL",
         "Maintained department websites and built small internal tools while studying.",
         ["Built a room-booking tool in PHP and MySQL used by 3 departments",
          "Automated accessibility checks for 200 pages"],
         ["PHP", "MySQL", "JavaScript", "WordPress"]),
    _exp(5, "Freelance", "Web Developer", "2015-06-01", "2016-08-31", "Remote",
         "Built websites and small web apps for local businesses.",
         ["Delivered 12 client websites", "Set up hosting and analytics for each client"],
         ["JavaScript", "WordPress", "HTML", "CSS"]),
]

PROJECTS = [
    {"id": "p1", "name": "DocQuery", "role": "Creator", "url": "https://github.com/example/docquery",
     "description": "Open-source retrieval-augmented question answering over PDF collections, with a FastAPI back end "
                    "and pgvector for embeddings.",
     "highlights": ["1,200 GitHub stars", "Hybrid keyword + vector retrieval with re-ranking"],
     "technologies": ["Python", "FastAPI", "PostgreSQL", "pgvector", "OpenAI API", "React"],
     "start_date": "2023-06-01", "end_date": None, "sort_order": 0},
    {"id": "p2", "name": "ShiftSwap", "role": "Co-founder", "url": None,
     "description": "Mobile-first shift trading app for hourly workers, piloted with two restaurant groups.",
     "highlights": ["Grew to 900 weekly active users during the pilot"],
     "technologies": ["React Native", "TypeScript", "Supabase", "Node.js"],
     "start_date": "2021-03-01", "end_date": "2022-04-01", "sort_order": 1},
    {"id": "p3", "name": "infra-starter", "role": "Maintainer", "url": "https://github.com/example/infra-starter",
     "description": "Terraform modules for a small-team AWS setup: VPC, ECS services, RDS and CI pipelines.",
     "highlights": ["Used by 30+ teams according to GitHub dependents"],
     "technologies": ["Terraform", "AWS", "GitHub Actions", "Docker"],
     "start_date": "2022-01-01", "end_date": None, "sort_order": 2},
    {"id": "p4", "name": "Trailmix", "role": "Creator", "url": None,
     "description": "Hiking trip planner that combines weather, trail and elevation data on a map.",
     "highlights": [], "technologies": ["Next.js", "Mapbox", "TypeScript"],
     "start_date": "2020-05-01", "end_date": "2020-09-01", "sort_order": 3},
    {"id": "p5", "name": "Kitchen Inventory Bot", "role": "Creator", "url": None,
     "description": "Slack bot that tracks office kitchen inventory and orders supplies.",
     "highlights": [], "technologies": ["Python", "Slack API"],
     "start_date": "2019-02-01", "end_date": "2019-04-01", "sort_order": 4},
    {"id": "p6", "name": "Open-source contributions", "role": "Contributor", "url": None,
     "description": "Fixes and docs to FastAPI ecosystem libraries and a React data-grid library.",
     "highlights": ["14 merged pull requests"], "technologies": ["Python", "React"],
     "start_date": "2021-01-01", "end_date": None, "sort_order": 5},
    {"id": "p7", "name": "Budget Buddy", "role": "Creator", "url": None,
     "description": "Personal finance tracker with bank CSV import and category rules.",
     "highlights": [], "technologies": ["Vue.js", "Firebase"],
     "start_date": "2018-01-01", "end_date": "2018-03-01", "sort_order": 6},
]

_SKILLS = [
    ("Python", "expert", 7), ("TypeScript", "expert", 6), ("JavaScript", "expert", 9), ("React", "expert", 7),
    ("Next.js", "advanced", 3), ("Node.js", "advanced", 5), ("FastAPI", "advanced", 3), ("PostgreSQL", "advanced", 6),
    ("Redis", "intermediate", 3), ("AWS", "advanced", 4), ("GCP", "intermediate", 2), ("Docker", "advanced", 5),
    ("Terraform", "intermediate", 3), ("GitHub Actions", "advanced", 4), ("Playwright", "intermediate", 2),
    ("Jest", "advanced", 5), ("LLMs", "intermediate", 2), ("OpenAI API", "intermediate", 2),
    ("pgvector", "intermediate", 1), ("Supabase", "intermediate", 2), ("React Native", "intermediate", 1),
    ("Redux", "advanced", 3), ("GraphQL", "intermediate", 2), ("REST APIs", "expert", 7), ("SQL", "expert", 7),
    ("Sass", "advanced", 3), ("Webpack", "intermediate", 3), ("PHP", "beginner", 2), ("MySQL", "intermediate", 2),
    ("Vue.js", "beginner", 1), ("Firebase", "beginner", 1), ("Mapbox", "beginner", 1), ("HL7/FHIR", "intermediate", 2),
    ("System design", "advanced", None), ("Mentoring", "intermediate", None),
    ("Kubernetes", "none", None), ("Go", "none", None),
]
SKILLS = [{"id": f"s{i}", "name": n, "level": lvl, "years": yrs, "sort_order": i}
          for i, (n, lvl, yrs) in enumerate(_SKILLS, start=1)]

EDUCATION = [
    {"id": "ed1", "institution": "Northgate University", "degree": "B.S.", "field_of_study": "Computer Science",
     "start_date": "2014-09-01", "end_date": "2018-05-31", "grade": "3.6 GPA",
     "description": "Coursework in distributed systems, databases and human-computer interaction.", "sort_order": 0},
    {"id": "ed2", "institution": "Online", "degree": "Certificate", "field_of_study": "Machine Learning Specialization",
     "start_date": "2022-01-01", "end_date": "2022-06-01", "grade": None, "description": None, "sort_order": 1},
]

ACHIEVEMENTS = [
    {"id": "a1", "title": "Engineering Excellence Award", "date": "2022-12-01",
     "description": "Company-wide award at Copperleaf Health for the booking-flow rebuild.", "sort_order": 0},
    {"id": "a2", "title": "Conference talk", "date": "2024-04-01",
     "description": "Spoke at a regional Python conference about hybrid retrieval in production.", "sort_order": 1},
    {"id": "a3", "title": "Hackathon winner", "date": "2019-10-01",
     "description": "First place at a city civic-tech hackathon.", "sort_order": 2},
    {"id": "a4", "title": "AWS Certified Developer – Associate", "date": "2023-03-01",
     "description": "Certification.", "sort_order": 3},
]

FACTS = [
    {"id": f"f{i}", "category": c, "prompt": p, "answer": a, "updated_at": f"2026-09-{10 + i:02d}T00:00:00Z"}
    for i, (c, p, a) in enumerate([
        ("conflict", "Describe a time you disagreed with a teammate",
         "At Copperleaf a teammate wanted to rewrite the scheduling service in Go; I thought the risk was too high "
         "before launch. We agreed on a two-week spike with clear success criteria, and decided together to keep Python."),
        ("failure", "Tell us about a time you failed",
         "A migration I ran at Harborline locked a large table for 6 minutes during business hours. I wrote the "
         "post-mortem, added a migration checklist and moved large migrations to online schema changes."),
        ("leadership", "Leadership example",
         "I led the reporting-performance project at Harborline: scoped it, split work between three engineers and "
         "ran the weekly demo with stakeholders."),
        ("motivation", "What kind of work motivates you",
         "Building products where data and good engineering directly save people time, especially in healthcare and analytics."),
        ("general", "Why are you looking for a new role",
         "I want to work on AI-heavy products at a company where engineers own features end to end."),
        ("strengths", "Biggest strength",
         "Taking ambiguous problems to a shipped, measured result: I scope carefully, ship in small steps and measure."),
        ("weakness", "Area for improvement",
         "I used to take on too much myself; I now delegate earlier and write design docs so others can pick work up."),
        ("general", "Preferred team size", "Small product teams of 4–8 engineers."),
    ], start=1)
]

PROFILE = {
    "id": USER_ID, "full_name": "Jordan Ellis", "headline": "Senior Full Stack Engineer · AI products",
    "location": "Denver, CO", "links": {"github": "https://github.com/example", "linkedin": "https://linkedin.com/in/example"},
    "summary": "Senior full-stack engineer with 8 years of experience building web products in React, TypeScript and "
               "Python. Recently focused on data-heavy analytics platforms and LLM features with retrieval.",
    "additional_context": "Comfortable owning features from database schema to UI. Interested in healthcare, "
                          "developer tools and analytics.",
    "work_authorization": "US citizen", "requires_sponsorship": False, "notice_period": "Three weeks",
    "salary_expectation": "$165,000–$185,000", "willing_to_relocate": False, "preferred_work_mode": "remote",
}

SAVED_ANSWERS = [
    # Saved for another employer: answering "Why are you interested in this role?" for Lumenfield adapts it.
    {"id": "sa1", "question": "Why are you interested in this role?", "company": "Northwind", "role": "Backend Engineer",
     "answer": "Northwind's focus on data-heavy products matches what I enjoy most. At Harborline Analytics I own the "
               "ingestion API and reporting service, and I'd like to bring that ownership to Northwind's backend team, "
               "working closely with product on features that save customers time.",
     "category": "motivation", "intent": "motivation_role", "use_count": 3, "updated_at": "2026-09-01T00:00:00Z"},
    {"id": "sa2", "question": "What is your LinkedIn profile URL?", "answer": "https://linkedin.com/in/example",
     "category": "general", "intent": "general", "use_count": 9, "updated_at": "2026-09-01T00:00:00Z"},
    {"id": "sa3", "question": "How did you hear about us?", "answer": "Through a friend who works on your team.",
     "category": "general", "intent": "general", "use_count": 4, "updated_at": "2026-09-01T00:00:00Z"},
]


def tables() -> Dict[str, List[Dict[str, Any]]]:
    return {"profiles": [PROFILE], "experiences": EXPERIENCES, "projects": PROJECTS, "skills": SKILLS,
            "education": EDUCATION, "achievements": ACHIEVEMENTS, "profile_facts": FACTS,
            "saved_answers": SAVED_ANSWERS, "usage_events": []}


def profile_rows() -> Dict[str, Any]:
    """The shape build_corpus reads."""
    return {"profile": PROFILE, "experiences": EXPERIENCES, "projects": PROJECTS, "skills": SKILLS,
            "education": EDUCATION, "achievements": ACHIEVEMENTS, "profile_facts": FACTS}


def _resume_exp(i, e, dates):
    bullets = [e["description"].split(": ")[-1].split(". ")[0].rstrip(".") + "."] + e["highlights"]
    return {"id": f"exp_{i}", "company": e["company"], "title": e["title"], "location": e["location"],
            "startDate": dates[0], "endDate": dates[1], "isCurrent": dates[1] == "Present",
            "bullets": [{"id": f"exp_{i}_b{j}", "text": t} for j, t in enumerate(bullets, start=1)],
            "technologies": e["technologies"]}


def resume() -> Dict[str, Any]:
    dates = [("Feb 2023", "Present"), ("Aug 2020", "Jan 2023"), ("Jun 2018", "Jul 2020"), ("Sep 2016", "May 2018"),
             ("Jun 2015", "Aug 2016")]
    projects = []
    for i, p in enumerate(PROJECTS[:4], start=1):
        bullets = [p["description"]] + p["highlights"]
        projects.append({"id": f"proj_{i}", "name": p["name"], "role": p["role"], "url": p["url"],
                         "startDate": (p["start_date"] or "")[:4] or None, "endDate": None,
                         "bullets": [{"id": f"proj_{i}_b{j}", "text": t} for j, t in enumerate(bullets, start=1)],
                         "technologies": p["technologies"]})
    return {
        "schemaVersion": 1,
        "contact": {"name": "Jordan Ellis", "headline": "Senior Full Stack Engineer", "email": "jordan@example.com",
                    "phone": "+1 555 0100", "location": "Denver, CO",
                    "links": [{"label": "GitHub", "url": "https://github.com/example"}]},
        "summary": PROFILE["summary"],
        "experience": [_resume_exp(i, e, dates[i - 1]) for i, e in enumerate(EXPERIENCES, start=1)],
        "projects": projects,
        "skills": [
            {"id": "skills_1", "label": "Languages", "items": ["Python", "TypeScript", "JavaScript", "SQL", "PHP"]},
            {"id": "skills_2", "label": "Frameworks", "items": ["React", "Next.js", "Node.js", "FastAPI", "Redux", "React Native"]},
            {"id": "skills_3", "label": "Data & Cloud", "items": ["PostgreSQL", "Redis", "pgvector", "AWS", "GCP", "Docker", "Terraform"]},
            {"id": "skills_4", "label": "Tools", "items": ["GitHub Actions", "Playwright", "Jest", "Webpack"]},
        ],
        "education": [{"id": "edu_1", "institution": "Northgate University", "degree": "B.S.",
                       "fieldOfStudy": "Computer Science", "startDate": "2014", "endDate": "2018", "grade": "3.6 GPA",
                       "bullets": []}],
        "achievements": [{"id": f"ach_{i}", "title": a["title"], "description": a["description"], "date": a["date"][:4],
                          "url": None} for i, a in enumerate(ACHIEVEMENTS[:3], start=1)],
        "certifications": [{"id": "cert_1", "name": "AWS Certified Developer – Associate", "issuer": "Amazon Web Services",
                            "date": "2023", "url": None}],
        "customSections": [],
    }


TYPICAL_JOB = {
    "title": "Senior Full Stack Engineer", "company": "Lumenfield", "location": "Remote (US)",
    "description": """About Lumenfield
Lumenfield builds analytics software for regional hospital networks. Our platform turns scheduling, staffing and patient-flow data into daily decisions for operations teams at more than 80 hospitals.

About the role
We're hiring a Senior Full Stack Engineer to join our Insights team. You'll build the product surfaces operations leaders use every morning, and the services and data pipelines behind them. You'll work with product, design and data science, and you'll own features end to end, from schema to UI.

What you'll do
- Design, build and operate customer-facing features in React and TypeScript
- Build and scale Python services (FastAPI) and the PostgreSQL data models behind them
- Ship LLM-powered features such as natural-language summaries of operational reports, with retrieval over customer data
- Improve performance and reliability of dashboards that query large datasets
- Take part in on-call, incident reviews and architecture discussions
- Mentor engineers and raise the quality bar through code review

What we're looking for
- 5+ years of professional software engineering experience
- Strong experience with React and TypeScript
- Strong experience with Python and building REST APIs
- Experience designing PostgreSQL schemas and optimizing queries
- Experience with AWS (ECS, RDS, S3) and infrastructure as code (Terraform)
- Experience shipping features that use large language models
- Clear written communication; comfortable working with non-technical stakeholders

Nice to have
- Healthcare experience, especially with HL7 or FHIR
- Experience with Kubernetes
- Experience with data pipelines (Airflow, dbt)
- Experience with vector search (pgvector, Elasticsearch)

Benefits
Fully remote within the US, with quarterly team offsites. Competitive salary and equity, 401(k) matching, comprehensive health, dental and vision insurance, a home office stipend, and 20 days of paid time off plus holidays. We're an equal opportunity employer and value diverse perspectives on our team.

How we work
Small, autonomous teams of 5–7 engineers. Written design docs for large changes, weekly demos, and a blameless incident culture. We deploy many times a day behind feature flags.""",
}

_LONG_EXTRA = """

Our engineering principles
We believe the best software comes from small teams with clear ownership. Every team owns its services in production, including monitoring, alerting and on-call. We favor boring, well-understood technology: PostgreSQL over exotic data stores, server-rendered pages where they work, and managed cloud services over self-hosted ones. We write design docs for changes that cross team boundaries and review them asynchronously, and we keep them short. We measure everything we ship and we remove features that don't earn their keep.

Your first 90 days
In your first month you'll pair with engineers across the Insights team, ship a small feature to production in your first week, and join the on-call rotation as a shadow. In your second month you'll take ownership of one of our reporting surfaces, including its API and data model, and lead a performance improvement project with a measurable goal. By your third month you'll be leading the design of a new LLM-powered feature with product and data science, from discovery interviews with hospital operations leaders to rollout.

The team
The Insights team is seven engineers, a product manager, a designer and a data scientist. The team owns the reporting platform: the ingestion services that receive scheduling and staffing feeds from hospital systems, the warehouse models that turn them into metrics, the API layer, and the React application operations leaders use every day. The team also owns the natural-language report summaries launched last year, which are now used by more than half of our customers every week.

Technology
Front end: React, TypeScript, Next.js, TanStack Query, Tailwind. Back end: Python 3.12, FastAPI, SQLAlchemy, Celery, Redis. Data: PostgreSQL 16, pgvector, dbt, Airflow, Snowflake. Infrastructure: AWS (ECS Fargate, RDS, S3, SQS), Terraform, GitHub Actions, Datadog. AI: hosted LLM APIs with retrieval over customer documents, an internal evaluation harness, and prompt versioning.

Interview process
1. A 30-minute call with a recruiter about your background and what you're looking for.
2. A 60-minute technical conversation with an engineer about a system you've built.
3. A take-home exercise (about three hours, paid) or a pairing session on a realistic problem, your choice.
4. A system design interview focused on data-heavy web applications.
5. A values interview with our VP of Engineering and a product manager.
We aim to complete the process within three weeks and we give feedback at every stage.

Compensation
The base salary range for this role is $170,000 to $200,000 depending on experience and location within the US, plus equity. We publish ranges for every role and we review compensation twice a year.

Diversity and inclusion
We're committed to building a diverse team and an inclusive culture. We encourage applications from people of all backgrounds, including those from groups underrepresented in technology. If you need accommodations during the interview process, tell your recruiter and we'll make it happen.

Security and compliance
Because we handle protected health information, all engineers complete HIPAA training during onboarding, and production data access is limited, audited and reviewed quarterly. We maintain SOC 2 Type II certification and run annual penetration tests. Engineers on the Insights team help design access controls for new features and take part in security reviews.

Working at Lumenfield
We're a remote-first company of 160 people across the US. We meet in person twice a year, and teams meet for planning once a quarter. We offer a learning budget of $2,000 per year, conference attendance, and a four-day work week in August. Parents get 16 weeks of fully paid leave. We provide a home office stipend and a monthly internet allowance.
"""

LONG_JOB = {**TYPICAL_JOB, "description": TYPICAL_JOB["description"] + _LONG_EXTRA}

# What a model's job analysis of TYPICAL_JOB looks like (the benchmark's scripted job_analysis output).
JOB_ANALYSIS = {
    "role": "Senior Full Stack Engineer", "company": "Lumenfield",
    "mustHave": [
        {"requirement": "React", "type": "skill"}, {"requirement": "TypeScript", "type": "skill"},
        {"requirement": "Python", "type": "skill"}, {"requirement": "FastAPI", "type": "skill"},
        {"requirement": "PostgreSQL", "type": "skill"}, {"requirement": "AWS", "type": "skill"},
        {"requirement": "AWS ECS", "type": "skill"}, {"requirement": "AWS RDS", "type": "skill"},
        {"requirement": "Terraform", "type": "skill"},
        {"requirement": "5+ years of professional software engineering experience", "type": "experience"},
        {"requirement": "Building REST APIs", "type": "experience"},
        {"requirement": "Designing PostgreSQL schemas and optimizing queries", "type": "experience"},
        {"requirement": "Shipping features that use large language models", "type": "experience"},
        {"requirement": "Clear written communication with non-technical stakeholders", "type": "soft_skill"},
    ],
    "niceToHave": [
        {"requirement": "Healthcare experience", "type": "domain"}, {"requirement": "HL7", "type": "skill"},
        {"requirement": "FHIR", "type": "skill"}, {"requirement": "Kubernetes", "type": "skill"},
        {"requirement": "Airflow", "type": "skill"}, {"requirement": "dbt", "type": "skill"},
        {"requirement": "pgvector", "type": "skill"}, {"requirement": "Elasticsearch", "type": "skill"},
        {"requirement": "Building data pipelines", "type": "experience"},
    ],
    "responsibilities": [
        "Build customer-facing features in React and TypeScript", "Build and scale Python services and data models",
        "Ship LLM-powered features with retrieval", "Improve dashboard performance and reliability",
        "Participate in on-call and architecture discussions", "Mentor engineers through code review",
    ],
    "minYearsExperience": 5,
}

YES_NO = ["Yes", "No"]

# (question, field kind, options or None, max length or None)
SCENARIO_A_QUESTIONS = [
    ("Are you legally authorized to work in the United States?", "choice_single", YES_NO, None),
    ("Will you now or in the future require sponsorship for employment visa status?", "choice_single", YES_NO, None),
    ("What is your notice period?", "input", None, None),
    ("What are your salary expectations?", "input", None, None),
    ("Are you willing to relocate?", "choice_single", YES_NO, None),
    ("Which work arrangement do you prefer?", "choice_single", ["Remote", "Hybrid", "On-site"], None),
    ("Do you have experience with Python?", "choice_single", YES_NO, None),
    ("How many years of experience do you have with React?", "number", None, None),
    ("Do you have experience with Kubernetes?", "choice_single", YES_NO, None),
    ("What is the highest level of education you have completed?", "choice_single",
     ["High school", "Bachelor's degree", "Master's degree", "PhD"], None),
]

SCENARIO_B_QUESTIONS = [
    ("Are you legally authorized to work in the United States?", "choice_single", YES_NO, None),
    ("Will you now or in the future require sponsorship for employment visa status?", "choice_single", YES_NO, None),
    ("What are your salary expectations?", "input", None, None),
    ("Why do you want to work at Lumenfield?", "textarea", None, 1500),
    ("Tell us about yourself.", "textarea", None, None),
    ("Describe a project you're proud of.", "textarea", None, None),
    ("Describe your experience with PostgreSQL.", "textarea", None, 1000),
    ("What experience do you have building features with large language models?", "textarea", None, None),
    ("Cover letter", "textarea", None, None),
]

SCENARIO_C_QUESTIONS = [
    ("Tell us about a technical challenge you solved and how you approached it.", "textarea", None, None),
    ("Describe a time you disagreed with a teammate. How did you resolve it?", "textarea", None, None),
    ("Give an example of a time you led a team or project.", "textarea", None, None),
    ("Why are you interested in this role?", "textarea", None, None),
    ("What is your greatest strength?", "textarea", None, None),
    ("Tell us about a time you failed and what you learned.", "textarea", None, None),
]

# More long questions on the same form, for the batch-size sweep (C + these = 10 long fields).
SCENARIO_C_EXTRA = [
    ("Describe your backend experience.", "textarea", None, None),
    ("Why are you a good fit for this role?", "textarea", None, None),
    ("Describe relevant projects.", "textarea", None, None),
    ("Describe a time you worked across teams.", "textarea", None, None),
]
