# Where the Google tag goes, and where it must not

Tag: `G-73XKQG9TBN`   (GA4 property PartyPlay, 554860060, under the GFLAM account)

**THE OLD TAG WAS POINTING AT NOTHING.** Until 18 September 2026 this said
`G-7S6R8QJSMQ`, and there was no GA4 property anywhere on any of Dean's five Analytics
accounts with that id. Every visit PartyPlay has ever had went into a void: the tag was
present, looked correct, cost a request on every page load, and measured nobody. Found
while building the traffic dashboard, by listing every property on every account rather
than trusting the id in the source.

A PartyPlay property was created on 18 Sep with the id above. **There is no history before
that date and there never will be.**

## Tagged
`index`, `start`, `booked`, `terms`, `privacy`

**`setup` is NOT tagged, though this file used to claim it was.** Checked page by page on
18 Sep. If you want the setup step measured, and it is arguably the most interesting step
in the funnel, it has to be added deliberately, mindful of the query-string rule below.

The buyer's journey. This is the only part where the numbers are worth anything:
how many people land, how many start a booking, how many finish it.

## NOT tagged, on purpose

**`host`, `run`, `move`** carry the **host key in the query string**. Google
Analytics sends the full page location by default, so tagging these would post
working host keys to a third party. Anyone holding one can move somebody's party
or delete their games. The `page_location` override in the snippet strips query
strings as a second line of defence, but the real protection is that these three
pages have no tag at all. **Do not add one.**

**`play`** is the guests. Thirty people scan a QR at a private party, none of them
bought anything and none of them agreed to anything. Tracking them contradicts the
privacy policy, and "we collect nothing about your guests" is one of the things the
product is built around and one of the things our lawyer has been told. It is also
a selling point worth more than the pageviews.

**`tv`** is a television. It generates one session that lasts all night and tells
you nothing.
