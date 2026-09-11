# Where the Google tag goes, and where it must not

Tag: `G-7S6R8QJSMQ`

## Tagged
`index`, `start`, `booked`, `setup`, `terms`, `privacy`

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
