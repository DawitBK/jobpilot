import { greenhouseConnector, rssConnector } from '../feeds.js';
import type { SOURCE_TYPES } from '../../db/schema.js';
import {
  ashbyConnector,
  bambooConnector,
  breezyConnector,
  leverConnector,
  personioConnector,
  recruiteeConnector,
  smartRecruitersConnector,
  workableConnector,
  workdayConnector,
} from './ats.js';
import {
  arbeitnowConnector,
  googleCareersConnector,
  hackerNewsConnector,
  himalayasConnector,
  jobicyConnector,
  remoteOkConnector,
  remotiveConnector,
} from './boards.js';
import { htmlListConnector, jsonApiConnector, structuredDataConnector } from './generic.js';
import type { JobSourceConnector } from './util.js';

export type SourceType = (typeof SOURCE_TYPES)[number];

/** Every kind of source, by the name stored in the database. */
export const CONNECTORS: Record<SourceType, JobSourceConnector> = {
  RSS: rssConnector,
  GREENHOUSE: greenhouseConnector,
  LEVER: leverConnector,
  ASHBY: ashbyConnector,
  WORKABLE: workableConnector,
  SMARTRECRUITERS: smartRecruitersConnector,
  RECRUITEE: recruiteeConnector,
  BREEZY: breezyConnector,
  PERSONIO: personioConnector,
  BAMBOOHR: bambooConnector,
  WORKDAY: workdayConnector,
  REMOTIVE: remotiveConnector,
  REMOTEOK: remoteOkConnector,
  HIMALAYAS: himalayasConnector,
  ARBEITNOW: arbeitnowConnector,
  JOBICY: jobicyConnector,
  HACKERNEWS: hackerNewsConnector,
  GOOGLE_CAREERS: googleCareersConnector,
  STRUCTURED_DATA: structuredDataConnector,
  JSON_API: jsonApiConnector,
  HTML_LIST: htmlListConnector,
};
