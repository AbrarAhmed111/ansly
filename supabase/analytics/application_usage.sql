-- Tokens, calls, cost and latency per job application, from provider-reported usage (public.llm_calls via the
-- application_usage view). Run in the Supabase SQL editor as the project owner (it reads every user's rows; the
-- app itself only ever sees a user's own). No prompt, answer, resume or job text is stored in either.
--
-- An "application" is one job_key (a posting) with any model call in the window. Embeddings are reported apart
-- from generation. Cost covers priced models only: unpriced_calls says how many calls had no price (add them to
-- core/pricing.py or MODEL_PRICING_JSON).

-- 1. Distribution per application (last 30 days): median, p75, p90, max.
select
  count(*) as applications,
  percentile_cont(0.5) within group (order by total_tokens) as median_tokens,
  percentile_cont(0.75) within group (order by total_tokens) as p75_tokens,
  percentile_cont(0.9) within group (order by total_tokens) as p90_tokens,
  max(total_tokens) as max_tokens,
  percentile_cont(0.5) within group (order by llm_calls) as median_llm_calls,
  round(percentile_cont(0.5) within group (order by total_cost_usd)::numeric, 5) as median_cost_usd,
  round(percentile_cont(0.9) within group (order by total_cost_usd)::numeric, 5) as p90_cost_usd,
  round(sum(cached_input_tokens)::numeric / nullif(sum(total_tokens), 0), 3) as cached_share,
  sum(unpriced_calls) as unpriced_calls
from public.application_usage
where last_at > now() - interval '30 days';

-- 2. The same by usage pattern, so one heavy behavior doesn't distort the average.
select
  usage_pattern,
  count(*) as applications,
  percentile_cont(0.5) within group (order by total_tokens) as median_tokens,
  percentile_cont(0.9) within group (order by total_tokens) as p90_tokens,
  percentile_cont(0.5) within group (order by llm_calls) as median_llm_calls,
  round(percentile_cont(0.5) within group (order by total_cost_usd)::numeric, 5) as median_cost_usd
from public.application_usage
where last_at > now() - interval '30 days'
group by usage_pattern
order by applications desc;

-- 3. Cost and tokens by stage, summed over the window (where the money goes).
select
  sum(job_analysis_tokens) as job_analysis_tokens, round(sum(job_analysis_cost_usd), 4) as job_analysis_usd,
  sum(matching_tokens) as matching_tokens, round(sum(matching_cost_usd), 4) as matching_usd,
  sum(tailoring_tokens) as tailoring_tokens, round(sum(tailoring_cost_usd), 4) as tailoring_usd,
  sum(validation_tokens) as validation_tokens, round(sum(validation_cost_usd), 4) as validation_usd,
  sum(answer_tokens) as answer_tokens, round(sum(answer_cost_usd), 4) as answer_usd,
  sum(regeneration_tokens) as regeneration_tokens, round(sum(regeneration_cost_usd), 4) as regeneration_usd,
  sum(adaptation_tokens) as adaptation_tokens, round(sum(adaptation_cost_usd), 4) as adaptation_usd,
  round(sum(generation_cost_usd), 4) as generation_usd,
  sum(query_embedding_tokens + profile_embedding_tokens) as embedding_tokens,
  round(sum(embedding_cost_usd), 4) as embedding_usd,
  round(sum(total_cost_usd), 4) as total_usd
from public.application_usage
where last_at > now() - interval '30 days';

-- 4. Outliers: applications over 20,000 tokens and what drove them.
select
  job_key, usage_pattern, total_tokens, llm_calls, failed_calls, single_answer_calls, batch_calls, regenerations,
  job_analysis_tokens, tailoring_tokens + matching_tokens as tailoring_tokens, answer_tokens, regeneration_tokens,
  round(total_cost_usd, 4) as cost_usd, last_at
from public.application_usage
where total_tokens > 20000 and last_at > now() - interval '30 days'
order by total_tokens desc
limit 50;

-- 5. Model calls by stage and model: latency, cache reads, thinking, failures (provider-reported).
select
  stage, provider, model, count(*) as calls,
  percentile_cont(0.5) within group (order by duration_ms) as median_ms,
  percentile_cont(0.9) within group (order by duration_ms) as p90_ms,
  round(avg(input_tokens + cache_read_tokens + cache_write_tokens)) as avg_input_tokens,
  round(avg(output_tokens)) as avg_output_tokens,
  round(avg(thinking_tokens)) as avg_thinking_tokens,
  -- Prompt caching at work: the share of calls that read any input from the provider's cache.
  round(avg((cache_read_tokens > 0)::int), 3) as cache_hit_rate,
  round(sum(cache_read_tokens)::numeric / nullif(sum(input_tokens + cache_read_tokens + cache_write_tokens), 0), 3)
    as cached_input_share,
  count(*) filter (where not ok) as unusable_outputs,
  round(sum(cost_usd), 4) as cost_usd
from public.llm_calls
where created_at > now() - interval '30 days'
group by stage, provider, model
order by calls desc;

-- 6. Model time per answer stage. (Time before the model, i.e. auth, Supabase reads and retrieval, is pre_llm_ms on
--    the API's per-request perf log line, next to the same request_id.)
select
  stage,
  count(*) as calls,
  percentile_cont(0.5) within group (order by duration_ms) as median_llm_ms,
  percentile_cont(0.9) within group (order by duration_ms) as p90_llm_ms,
  percentile_cont(0.5) within group (order by ttft_ms) as median_ttft_ms
from public.llm_calls
where stage in ('answer', 'answer_simple', 'answer_complex', 'answer_batch', 'answer_regeneration',
                'answer_adaptation')
  and created_at > now() - interval '30 days'
group by stage
order by calls desc;

-- 7. Answer quality signals: regenerations per generated answer, edits before filling, and the user's wait.
select
  count(*) filter (where kind = 'generate') as generated,
  count(*) filter (where kind = 'regenerate') as regenerated,
  round(count(*) filter (where kind = 'regenerate')::numeric
        / nullif(count(*) filter (where kind = 'generate'), 0), 3) as regenerations_per_generated,
  count(*) filter (where kind = 'fill') as filled,
  round(avg(edited::int) filter (where kind = 'fill' and edited is not null), 3) as edited_before_fill_rate,
  percentile_cont(0.5) within group (order by duration_ms) filter (where kind = 'fill') as median_wait_ms,
  percentile_cont(0.9) within group (order by duration_ms) filter (where kind = 'fill') as p90_wait_ms
from public.usage_events
where created_at > now() - interval '30 days';

-- 8. Which question categories get regenerated most (a better first answer saves more than prompt trimming).
select
  category,
  count(*) filter (where kind = 'generate') as generated,
  count(*) filter (where kind = 'regenerate') as regenerated,
  round(count(*) filter (where kind = 'regenerate')::numeric
        / nullif(count(*) filter (where kind = 'generate'), 0), 3) as regenerations_per_generated,
  round(avg(edited::int) filter (where kind = 'fill' and edited is not null), 3) as edited_before_fill_rate
from public.usage_events
where kind in ('generate', 'regenerate', 'fill') and created_at > now() - interval '30 days'
group by category
order by regenerated desc;
