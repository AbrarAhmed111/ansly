-- Prefills the Ansly profile for the account eersam36@gmail.com from Abrar Ahmed's resume.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: it replaces this account's experience, projects, skills, education
-- and achievements (saved answers and usage history are left alone).
--
-- Only facts stated on the resume are included. Where the resume gives just a year
-- (or no month), the date is left empty and the years are written in the description,
-- so Ansly never claims a month that isn't on the resume.

do $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = 'eersam36@gmail.com';
  if uid is null then
    raise exception 'No user with email eersam36@gmail.com — sign up first';
  end if;

  -- Personal details -------------------------------------------------------
  insert into public.profiles (id, full_name, headline, email, phone, location, summary, links)
  values (
    uid,
    'Abrar Ahmed',
    'Full Stack AI Engineer · Next.js · TypeScript · Python · LLM Applications',
    'abrarahmedishere@gmail.com',
    '+92 335 8170245',
    'Islamabad, Pakistan',
    'Full Stack AI Engineer with 3+ years building production web apps, SaaS products, and AI-powered systems. '
      || 'Delivered 100+ projects, led teams of up to six, and mentored 16+ developers (8+ now in internships or professional roles). '
      || 'Ships LLM features (RAG, agents, AI reports) end to end with founders and clients, from idea to production.',
    jsonb_build_object(
      'website', 'https://abrarahmed.pro',
      'linkedin', 'https://linkedin.com/in/abrar-ahmed-b7a471242',
      'github', 'https://github.com/AbrarAhmed111'
    )
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    headline = excluded.headline,
    email = excluded.email,
    phone = excluded.phone,
    location = excluded.location,
    summary = excluded.summary,
    links = excluded.links;

  -- Clear previous section rows for this user --------------------------------
  delete from public.experiences where user_id = uid;
  delete from public.projects where user_id = uid;
  delete from public.skills where user_id = uid;
  delete from public.education where user_id = uid;
  delete from public.achievements where user_id = uid;

  -- Experience ---------------------------------------------------------------
  insert into public.experiences
    (user_id, company, title, location, employment_type, start_date, end_date, is_current, description, highlights, technologies, sort_order)
  values
    (uid, 'Nizam LLC', 'Software Engineer', 'USA · Remote', null, '2025-03-01', '2026-04-01', false,
     'Sole full-stack engineer, owning the product lifecycle from architecture to production and partnering with the founder to turn business goals into shipped features.',
     array[
       'Served as the sole full-stack engineer, owning the product lifecycle from architecture to production and partnering with the founder to turn business goals into shipped features.',
       'Designed and built scalable APIs, database schemas, and real-time features with Next.js and PostgreSQL.',
       'Strengthened performance and security across the platform, reducing load times and improving reliability.',
       'Owned production deployments and CI/CD pipelines; established code-review practices and engineering standards.'
     ],
     array['Next.js', 'PostgreSQL', 'CI/CD'], 0),

    (uid, 'WebWhiz', 'Development Team Lead', 'Lahore · Remote', null, '2024-02-01', '2025-03-01', false,
     'Led cross-functional developer teams through full project lifecycles as the primary client contact.',
     array[
       'Led cross-functional developer teams through full project lifecycles as the primary client contact, running technical planning, sprint reviews, standups, and mentorship sessions.',
       'Set standards for project structure, version control, and deployment; delivered on time and on budget while coding hands-on across the stack.'
     ],
     array[]::text[], 1),

    (uid, 'CosVM Labs', 'Frontend Team Lead', 'Remote', null, '2024-01-01', '2024-05-01', false,
     'Led six frontend developers in rebuilding BUYCEX, a cryptocurrency exchange, from a static HTML site into a dynamic React application.',
     array[
       'Led six frontend developers in rebuilding BUYCEX, a cryptocurrency exchange, from a static HTML site into a dynamic React application with authentication, user-management, and transaction APIs.'
     ],
     array['React'], 2),

    (uid, 'CortechSols', 'Frontend Developer', 'Islamabad', null, '2023-06-01', null, false,
     'Frontend developer from June 2023 into 2024. Owned UI development for 15+ industrial projects.',
     array[
       'Owned UI development for 15+ industrial projects and shipped 20+ websites with React, Next.js, and TypeScript, building responsive, real-time interfaces on REST APIs.'
     ],
     array['React', 'Next.js', 'TypeScript', 'REST APIs'], 3),

    (uid, 'Upwork · Fiverr · LinkedIn', 'Freelance Software Developer', 'Remote (part-time)', 'freelance', null, null, true,
     'Part-time freelance software developer since 2022, delivering websites and apps for clients in the USA, UK, and UAE.',
     array[
       'Delivered 100+ websites and apps (e-commerce, MVPs, SaaS, MERN) for clients in the USA, UK, and UAE, owning each project from scoping to deployment.'
     ],
     array['MongoDB', 'Express', 'React', 'Node.js'], 4);

  -- Projects -----------------------------------------------------------------
  insert into public.projects
    (user_id, name, role, url, description, highlights, technologies, sort_order)
  values
    (uid, 'OnTask', 'Architect and developer', 'https://ontask1.vercel.app',
     'Open-source work execution platform with shared workspaces, tasks, goals, dependencies, real-time activity, AI-generated daily reports, and Slack/GitHub integrations.',
     array[
       'Architected and actively develop the platform.',
       'Shared workspaces with tasks, goals, dependencies, and real-time activity.',
       'AI-generated daily reports and Slack/GitHub integrations.',
       'Used daily by 6–8 people.'
     ],
     array['Next.js', 'TypeScript', 'Supabase', 'PostgreSQL'], 0),

    (uid, 'MamtaAI', 'Solo designer and developer', 'https://mamtaai.vercel.app',
     'AI-powered baby care platform, designed and built solo.',
     array[
       'Activity tracking, caregiver management, and real-time notifications.',
       'Bluetooth pulse-oximeter integration.',
       'ML-based baby cry classification.'
     ],
     array['Next.js', 'Audio-processing APIs', 'Machine learning'], 1),

    (uid, 'PromptGraphy', null, 'https://promptgraphy.ai',
     'Production AI content generation SaaS for text, image, and video generation across multiple AI providers.',
     array[
       'Text, image, and video generation across multiple AI providers.',
       'Stripe subscription billing.',
       'Image editing, background removal, inpainting, and prompt management.'
     ],
     array['Next.js', 'TypeScript', 'Supabase', 'PostgreSQL', 'Stripe'], 2);

  -- Skills -------------------------------------------------------------------
  insert into public.skills (user_id, name, category, sort_order)
  select uid, s.name, s.category, s.ord
  from (values
    -- Frontend
    ('React.js', 'framework', 0), ('Next.js', 'framework', 1), ('TypeScript', 'language', 2),
    ('Tailwind CSS', 'framework', 3), ('Redux', 'framework', 4), ('Bootstrap', 'framework', 5),
    ('ReactStrap', 'framework', 6), ('Firebase', 'cloud', 7),
    -- Backend & data
    ('Python', 'language', 8), ('Node.js', 'framework', 9), ('Next.js API Routes', 'framework', 10),
    ('FastAPI', 'framework', 11), ('REST APIs', 'other', 12), ('PostgreSQL', 'database', 13),
    ('Supabase', 'database', 14), ('MongoDB', 'database', 15), ('MySQL', 'database', 16),
    -- AI / LLM
    ('OpenAI', 'ai', 17), ('Anthropic', 'ai', 18), ('Gemini', 'ai', 19), ('LangChain', 'ai', 20),
    ('LangGraph', 'ai', 21), ('RAG', 'ai', 22), ('LLM Workflows', 'ai', 23), ('AI Agents', 'ai', 24),
    ('Prompt Engineering', 'ai', 25), ('AI Guardrails', 'ai', 26), ('LLM Evaluations', 'ai', 27),
    -- Cloud, DevOps & practices
    ('AWS', 'cloud', 28), ('Azure', 'cloud', 29), ('Vercel', 'cloud', 30), ('CI/CD', 'cloud', 31),
    ('Git', 'tool', 32), ('GitHub', 'tool', 33), ('Stripe', 'tool', 34),
    ('System Architecture', 'other', 35), ('Agile/Scrum', 'soft', 36), ('Sprint Planning', 'soft', 37),
    ('Code Reviews', 'soft', 38)
  ) as s(name, category, ord);

  -- Education ----------------------------------------------------------------
  insert into public.education (user_id, institution, degree, field_of_study, description, sort_order)
  values (uid, 'SZABIST Islamabad', 'BS', 'Computer Science', 'Studied 2022 – 2026.', 0);

  -- Achievements (from the resume summary) ------------------------------------
  insert into public.achievements (user_id, title, description, sort_order)
  values
    (uid, 'Delivered 100+ projects', 'Delivered 100+ websites, apps and SaaS projects for clients in the USA, UK, and UAE.', 0),
    (uid, 'Mentored 16+ developers', 'Mentored 16+ developers; 8+ of them are now in internships or professional roles.', 1),
    (uid, 'Led teams of up to six', 'Led development teams of up to six, including six frontend developers on the BUYCEX rebuild at CosVM Labs.', 2);
end;
$$;

-- Check the result:
select
  (select full_name from public.profiles p join auth.users u on u.id = p.id where u.email = 'eersam36@gmail.com') as name,
  (select count(*) from public.experiences e join auth.users u on u.id = e.user_id where u.email = 'eersam36@gmail.com') as experiences,
  (select count(*) from public.projects e join auth.users u on u.id = e.user_id where u.email = 'eersam36@gmail.com') as projects,
  (select count(*) from public.skills e join auth.users u on u.id = e.user_id where u.email = 'eersam36@gmail.com') as skills,
  (select count(*) from public.education e join auth.users u on u.id = e.user_id where u.email = 'eersam36@gmail.com') as education,
  (select count(*) from public.achievements e join auth.users u on u.id = e.user_id where u.email = 'eersam36@gmail.com') as achievements;
