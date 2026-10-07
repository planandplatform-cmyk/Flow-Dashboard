/**
 * Key terms shown on the glossary page. Wording follows FFM's monthly report.
 * Individual metric tooltips use the definitions in config.ts.
 */
export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "followers",
    term: "Followers",
    definition:
      "The total number of people who have chosen to follow your page or profile to see your updates in their feed.",
  },
  {
    id: "net_new_followers",
    term: "Net New Followers",
    definition:
      "The number of new followers gained minus the number of people who unfollowed during the reporting period.",
  },
  {
    id: "reach_views",
    term: "Reach / Views",
    definition:
      "Reach is the number of different people who saw your content. Views is the total number of times your content or page was seen, so one person can count more than once.",
  },
  {
    id: "content_interactions",
    term: "Content Interactions",
    definition:
      "Any active engagement with your content, including likes, reactions, comments, shares, and saves.",
  },
  {
    id: "engagement_rate",
    term: "Engagement Rate",
    definition:
      "The percentage of people who interacted with your content out of everyone who saw it. On your website, it is the share of visits where people stayed, browsed, or took action.",
  },
  {
    id: "profile_visits",
    term: "Profile Visits",
    definition:
      "The number of times people clicked through to view your main profile or page from a post or search.",
  },
];
